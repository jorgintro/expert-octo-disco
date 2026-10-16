// Vistas del resumen: panel de administración y lienzo de la vista /pantallazo.
import { VACIO, formatoPorcentaje } from './participacion.js';
import { TIPO_ELECCION, VARIANTES } from './resumen.js';
import { tablaRecuento } from './vistasRecuento.js';
import { bloqueSenado, tablaSenado } from './vistasSenado.js';
import { crudo, html, recurso } from './vistas.js';

const corto = (p) => formatoPorcentaje(p).replace(' %', '%');
const SCRIPT = html`<script src="${recurso('/resumen.js')}" defer></script>`;

// Marcador del sondeo: resumen.js lo busca para refrescar la página sola.
const sondeo = (ms) => html`<div id="sondeo" data-intervalo="${ms}" hidden></div>`;

// Franja que solo se ve (body.sin-conexion) cuando falla el sondeo: una captura nunca debe mostrar datos viejos sin avisarlo.
const sinConexion = (hora) => html`<p class="aviso-sin-conexion" role="alert">SIN CONEXIÓN · los datos son de las ${hora}</p>`;

const sello = (resumen) => {
  const t = resumen.indiceUltimo >= 0 ? resumen.totales[resumen.indiceUltimo] : null;
  if (!t) return html`<p class="sello provisional">PROVISIONAL · sin datos todavía</p>`;
  return resumen.provisional
    ? html`<p class="sello provisional">PROVISIONAL · ${t.informadas}/${t.total} mesas en el corte de las ${t.corte.hora}</p>`
    : html`<p class="sello completo">COMPLETO · ${t.informadas}/${t.total} mesas en el corte de las ${t.corte.hora}</p>`;
};

// ---------- Panel de administración ----------
function celdaPanel(c, enlace) {
  return c.vacio
    ? html`<td class="num vacia"><a class="celda vacia" href="${enlace}">${VACIO}</a></td>`
    : html`<td class="num"><a class="celda" href="${enlace}"><strong>${c.acumulado}</strong><small>+${c.parcial}</small><small>${corto(c.porcentaje)}</small></a></td>`;
}

export function panelResumen({ resumen, hora, fecha }) {
  const { totales, mesas } = resumen;
  return html`<section class="tarjeta estado-resumen">
  <p class="hora-grande">Actualizado: <time id="hora-actualizacion">${hora}</time> <span class="nota">${fecha} · hora de Madrid</span></p>
  <p id="estado-sondeo" class="nota" role="status">Se actualiza sola cada pocos segundos.</p>
  ${sinConexion(hora)}
  ${sello(resumen)}
  ${resumen.indiceUltimo >= 0 && resumen.pendientesUltimo.length > 0
    ? html`<p class="nota">Faltan por informar (corte de las ${totales[resumen.indiceUltimo].corte.hora}): <strong>${resumen.pendientesUltimo.map((c, i) => html`${i ? ', ' : ''}<span class="cod">${c}</span>`)}</strong></p>`
    : ''}
</section>
<div class="tabla-scroll"><table class="tabla-resumen">
  <thead><tr><th class="fija">Mesa</th>${totales.map((t) => html`<th class="num">${t.corte.hora}<span class="faltan">${t.informadas}/${t.total}</span></th>`)}</tr></thead>
  <tbody>
    ${mesas.map(
      ({ mesa, historial }) => html`<tr>
      <th scope="row" class="fija">${mesa.codigo}<span class="nota">censo ${mesa.censo}</span></th>
      ${historial.map((c, i) => celdaPanel(c, `/admin/participacion/${mesa.id}/${totales[i].corte.id}`))}
    </tr>`
    )}
  </tbody>
  <tfoot><tr><th class="fija">Total</th>${totales.map((t) =>
    t.informadas === 0
      ? html`<td class="num vacia">${VACIO}</td>`
      : html`<td class="num"><strong>${t.acumulado}</strong><small>+${t.parcial}</small><small>${corto(t.porcentaje)}</small></td>`
  )}</tr></tfoot>
</table></div>
<p class="nota">Cada celda: acumulado · <small>+parcial del tramo</small> · <small>% sobre censo</small>. En «Total», el % es sobre el censo de las mesas informadas en ese corte. Toca una celda para introducir o corregir el dato. Debajo de cada hora: mesas informadas/total.</p>
${sondeo(5000)}
${SCRIPT}`;
}

// ---------- /pantallazo ----------
function tablaParticipacion(resumen) {
  const idx = resumen.indicesConDatos;
  if (idx.length === 0) return html`<p class="sin-datos">Todavía no hay datos de participación.</p>`;
  return html`<table class="tabla-pantallazo">
  <thead><tr><th>Mesa</th>${idx.map((i) => html`<th>${resumen.totales[i].corte.hora.replace(/^0/, '').replace(':00', '')}h</th>`)}</tr></thead>
  <tbody>
    ${resumen.mesas.map(
      ({ mesa, historial }) => html`<tr><th scope="row">${mesa.codigo}</th>${idx.map((i) => {
        const c = historial[i];
        return c.vacio ? html`<td class="vacia">${VACIO}</td>` : html`<td><span class="v">${c.acumulado}</span><span class="p">${corto(c.porcentaje)}</span></td>`;
      })}</tr>`
    )}
  </tbody>
  <tfoot><tr class="total"><th scope="row">TOTAL</th>${idx.map((i) => {
    const t = resumen.totales[i];
    return html`<td><span class="v">${t.acumulado}</span><span class="p">${corto(t.porcentaje)}</span></td>`;
  })}</tr>
  <tr class="informadas"><th scope="row">Mesas</th>${idx.map((i) => html`<td>${resumen.totales[i].informadas}/${resumen.totales[i].total}</td>`)}</tr></tfoot>
</table>`;
}

function tablaUltimo(resumen) {
  if (resumen.indiceUltimo < 0) return html`<p class="sin-datos">Todavía no hay datos de participación.</p>`;
  const i = resumen.indiceUltimo;
  const t = resumen.totales[i];
  return html`<p class="corte-titulo">Corte de las <strong>${t.corte.hora}</strong></p>
<table class="tabla-pantallazo tabla-ultimo">
  <thead><tr><th>Mesa</th><th>Acum.</th><th>Parcial</th><th>%</th></tr></thead>
  <tbody>
    ${resumen.mesas.map(({ mesa, historial }) => {
      const c = historial[i];
      return c.vacio
        ? html`<tr class="vacia"><th scope="row">${mesa.codigo}</th><td colspan="3">sin dato</td></tr>`
        : html`<tr><th scope="row">${mesa.codigo}</th><td><span class="v">${c.acumulado}</span></td><td>+${c.parcial}</td><td>${corto(c.porcentaje)}</td></tr>`;
    })}
  </tbody>
  <tfoot><tr class="total"><th scope="row">TOTAL</th><td><span class="v">${t.acumulado}</span></td><td>+${t.parcial}</td><td>${corto(t.porcentaje)}</td></tr></tfoot>
</table>`;
}

const selloRecuento = (r) =>
  r.provisional
    ? html`<p class="sello provisional">PROVISIONAL · ${r.cerradas}/${r.totalMesas} mesas escrutadas</p>`
    : html`<p class="sello completo">COMPLETO · ${r.cerradas}/${r.totalMesas} mesas escrutadas</p>`;

export function lienzoPantallazo({ colegio, resumen, resumenRecuento = null, resumenSenado = null, variante, modo, hora, fecha, texto }) {
  const demo = modo === 'DEMO';
  const esRecuento = variante.id === 'recuento';
  const esSenado = variante.id === 'senado';
  return html`<div class="lienzo" id="lienzo">
  ${demo ? html`<div class="marca-agua" aria-hidden="true"><span>DEMO</span></div>` : ''}
  <header class="lienzo-cabecera">
    <h1>${colegio}</h1>
    <p class="subtitulo-lienzo">${TIPO_ELECCION} · ${esRecuento ? 'Recuento del Congreso' : esSenado ? 'Senado' : variante.etiqueta}</p>
    <p class="hora-pantallazo">Actualizado <time id="hora-actualizacion">${hora}</time></p>
    <p class="fecha-pantallazo">${fecha} · hora de Madrid</p>
  </header>
  ${sinConexion(hora)}
  ${demo ? html`<p class="sello demo">DEMO · DATOS DE PRUEBA</p>` : ''}
  ${esRecuento ? selloRecuento(resumenRecuento) : esSenado ? selloRecuento(resumenSenado) : sello(resumen)}
  ${esRecuento ? tablaRecuento(resumenRecuento) : esSenado ? tablaSenado(resumenSenado) : variante.id === 'ultimo' ? tablaUltimo(resumen) : tablaParticipacion(resumen)}
  ${esSenado ? bloqueSenado(resumenSenado) : ''}
  ${esSenado
    ? html`<p class="nota-lienzo">% sobre papeletas válidas (cada elector marca hasta 3 nombres: no suman 100). Solo mesas cerradas.</p>`
    : esRecuento
    ? html`<p class="nota-lienzo">% sobre votos válidos (candidaturas + blancos). Solo mesas cerradas.</p>`
    : resumen.provisional && resumen.indiceUltimo >= 0
      ? html`<p class="nota-lienzo">TOTAL: % sobre el censo de las mesas informadas.</p>`
      : ''}
</div>
<section class="controles" aria-label="Controles de la captura">
  <nav class="pildoras" aria-label="Variante">
    ${VARIANTES.map((v) =>
      v.disponible
        ? html`<a class="${v.id === variante.id ? 'pildora activa' : 'pildora'}" href="/pantallazo?variante=${v.id}"${v.id === variante.id ? crudo(' aria-current="true"') : ''}>${v.etiqueta}</a>`
        : html`<span class="pildora desactivada" aria-disabled="true" title="Disponible en una próxima versión">${v.etiqueta}</span>`
    )}
  </nav>
  <div class="botones-fila">
    <button type="button" class="boton" data-copiar>Copiar como texto</button>
    <button type="button" class="boton boton-sec" data-captura>Modo captura</button>
  </div>
  <p id="estado-copia" class="nota" role="status"></p>
  <details><summary>Ver el texto que se copia</summary>
    <textarea id="texto-whatsapp" class="texto-wa" readonly rows="10">${texto}</textarea>
  </details>
  <p class="nota">«Modo captura» oculta estos controles para hacer un pantallazo limpio; toca el título para volver a verlos.</p>
  <p><a href="/admin/resumen">Volver al panel</a></p>
</section>
${sondeo(10000)}
${SCRIPT}`;
}
