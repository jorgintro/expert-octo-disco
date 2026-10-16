// Piezas HTML comunes de la captura de participación (vista del agente y del administrador).
import { VACIO, formatoPorcentaje } from './participacion.js';
import { formatearMadrid } from './tiempo.js';
import { html, recurso } from './vistas.js';

const SCRIPT = html`<script src="${recurso('/agente.js')}" defer></script>`;

export function formularioDato({ csrf, accion, corteId = null, valor = '', boton = 'Guardar' }) {
  return html`<form method="post" action="${accion}" class="formulario form-dato">
  <input type="hidden" name="_csrf" value="${csrf}">
  ${corteId === null ? '' : html`<input type="hidden" name="corte" value="${corteId}">`}
  <label for="votantes">Votantes acumulados</label>
  <input id="votantes" name="votantes" class="campo-numero" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" required value="${valor}">
  <button type="submit" class="boton">${boton}</button>
  <p id="estado-envio" class="estado-envio" role="status" aria-live="polite"></p>
</form>
${SCRIPT}`;
}

export function bloqueConfirmar({ csrf, accion, corteId = null, valor, avisos, urlCorregir }) {
  return html`<section class="tarjeta confirmar" role="alert">
  <h2>Revisa antes de guardar</h2>
  <p>Vas a guardar <strong>${valor}</strong> votantes acumulados.</p>
  <ul>${avisos.map((a) => html`<li>${a}</li>`)}</ul>
  <form method="post" action="${accion}" class="formulario form-dato">
    <input type="hidden" name="_csrf" value="${csrf}">
    ${corteId === null ? '' : html`<input type="hidden" name="corte" value="${corteId}">`}
    <input type="hidden" name="votantes" value="${valor}">
    <input type="hidden" name="confirmar" value="1">
    <button type="submit" class="boton">Sí, guardar ${valor}</button>
    <p id="estado-envio" class="estado-envio" role="status" aria-live="polite"></p>
  </form>
  <p><a class="boton boton-sec" href="${urlCorregir}">No, corregir</a></p>
</section>
${SCRIPT}`;
}

export function selectorCortes({ cortes, filas, seleccionadoId, actualId, urlBase }) {
  const conDato = new Set(filas.map((f) => f.corte_id));
  return html`<nav class="pildoras" aria-label="Elegir corte">
  ${cortes.map(
    (c) => html`<a href="${urlBase}?corte=${c.id}" class="${c.id === seleccionadoId ? 'pildora activa' : 'pildora'}"${c.id === seleccionadoId ? html` aria-current="true"` : ''}>${c.hora}${conDato.has(c.id) ? ' ✓' : ''}${c.id === actualId ? ' ●' : ''}</a>`
  )}
</nav>
<p class="nota">✓ con dato · ● corte actual</p>`;
}

export function tablaHistorial({ filas, urlBase = null }) {
  return html`<div class="tabla-scroll"><table class="historial">
  <thead><tr><th>Corte</th><th class="num">Acumulado</th><th class="num">Parcial</th><th class="num">% censo</th></tr></thead>
  <tbody>
    ${filas.map((f) => {
      const hora = urlBase ? html`<a href="${urlBase}?corte=${f.corte.id}">${f.corte.hora}</a>` : f.corte.hora;
      return f.vacio
        ? html`<tr class="vacia"><td>${hora}</td><td class="num vacia">${VACIO}</td><td class="num vacia">${VACIO}</td><td class="num vacia">${VACIO}</td></tr>`
        : html`<tr><td>${hora}${f.tipo === 'admin' ? html` <span class="marca-admin" title="Introducido por el administrador">A</span>` : ''}</td><td class="num">${f.acumulado}</td><td class="num">${f.parcial}</td><td class="num">${formatoPorcentaje(f.porcentaje)}</td></tr>`;
    })}
  </tbody>
</table></div>
<p class="nota">Parcial = acumulado menos el del corte anterior. <span class="marca-admin">A</span> = introducido por el administrador.</p>`;
}

// «el administrador · 20/10/2026 12:03:11» / «agente María · …»
export function autorDe(db, fila) {
  const quien =
    fila.introducido_por_tipo === 'admin'
      ? 'el administrador'
      : `agente ${db.prepare('SELECT nombre FROM agente WHERE id = ?').get(fila.introducido_por_id)?.nombre ?? '(desconocido)'}`;
  return `${quien} · ${formatearMadrid(fila.actualizado_en)}`;
}
