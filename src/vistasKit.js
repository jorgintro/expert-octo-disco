import { ROLES_SOLO } from './kit.js';
import { html, recurso } from './vistas.js';

const SCRIPT = html`<script src="${recurso('/kit.js')}" defer></script>`;

const etiquetas = (p) => html`${p.solo ? html` <span class="kit-etiqueta">${ROLES_SOLO[p.solo]}</span>` : ''}${p.verificar ? html` <span class="kit-etiqueta pendiente">Pendiente de verificar</span>` : ''}`;

function fase(f) {
  return html`<section class="tarjeta kit-fase" data-fase id="fase-${f.id}">
  <h2>${f.titulo} <span class="kit-progreso" data-progreso aria-live="polite">0/${f.puntos.length}</span></h2>
  <ul class="kit-lista">${f.puntos.map(
    (p) => html`
    <li class="kit-punto${p.verificar ? ' por-verificar' : ''}">
      <label class="casilla kit-casilla"><input type="checkbox" data-id="${p.id}"><span class="kit-texto">${p.texto}${etiquetas(p)}</span></label>
      <span class="kit-hora" data-hora></span>
    </li>`
  )}
  </ul>
</section>`;
}

function seccion(s) {
  return html`<details class="kit-seccion" id="guia-${s.id}">
  <summary>${s.titulo}</summary>
  ${s.intro ? html`<p class="nota">${s.intro}</p>` : ''}
  <ul class="kit-guia">${s.puntos.map((p) => html`<li class="${p.verificar ? 'por-verificar' : ''}">${p.texto}${etiquetas(p)}</li>`)}</ul>
</details>`;
}

// `clave` identifica el estado del dispositivo (checklist) y va ligada al agente (o al administrador).
export function cuerpoKit({ kit, clave, colegio, modo, esAdmin }) {
  const pendientes = esAdmin && (kit.fases.some((f) => f.puntos.some((p) => p.verificar)) || kit.secciones.some((s) => s.puntos.some((p) => p.verificar)));
  return html`<div id="kit" data-clave="${clave}" data-colegio="${colegio}" data-modo="${modo}">
<div class="kit-saludo">
  <img src="${recurso('/dulcinea.webp')}" width="96" height="96" alt="Dulcinea, la agente electoral, saludando">
  <p><strong>Soy Dulcinea.</strong> Aquí tienes tu checklist y unos consejos para la jornada. ¡Ánimo!</p>
</div>
<nav class="pildoras kit-nav" aria-label="Secciones del kit">
  <a class="pildora" href="#checklist">Checklist</a>
  <a class="pildora" href="#guia">Guía</a>
</nav>
${pendientes ? html`<p class="aviso-verificar" role="note">Vista de administrador: los puntos «pendiente de verificar» no los ven los agentes hasta que quites la marca [VERIFICAR] en <code>content/</code>.</p>` : ''}
<section id="checklist" aria-labelledby="t-checklist">
  <h2 id="t-checklist" class="kit-titulo">Checklist de la jornada</h2>
  <p class="nota">Marca cada punto cuando lo hagas: se guarda la hora. Las marcas quedan solo en este móvil.</p>
  <p class="kit-total" aria-live="polite"><strong data-total>0</strong> de ${kit.fases.reduce((n, f) => n + f.puntos.length, 0)} hechos</p>
  ${kit.fases.map(fase)}
  <div class="kit-botones">
    <button type="button" class="boton" data-copiar-kit>Copiar como texto</button>
    <button type="button" class="boton boton-sec" data-reiniciar>Reiniciar</button>
  </div>
  <div class="tarjeta kit-confirmar" data-confirmar hidden role="alertdialog" aria-label="Confirmar reinicio">
    <p><strong>¿Borrar todas las marcas y sus horas?</strong> No se puede deshacer.</p>
    <div class="botones-fila">
      <button type="button" class="boton" data-reiniciar-si>Sí, reiniciar</button>
      <button type="button" class="boton boton-sec" data-reiniciar-no>Cancelar</button>
    </div>
  </div>
  <p id="kit-estado" class="nota" role="status"></p>
  <details class="kit-texto-copia">
    <summary>Texto para copiar</summary>
    <textarea id="kit-texto" readonly rows="10" aria-label="Texto del checklist para copiar"></textarea>
  </details>
  <p id="kit-sin-almacen" class="aviso-bloqueo" role="status" hidden>Este navegador no permite guardar las marcas: seguirán ahí mientras no cierres la página.</p>
</section>
<section id="guia" aria-labelledby="t-guia">
  <h2 id="t-guia" class="kit-titulo">Guía de consejos</h2>
  ${kit.secciones.map(seccion)}
</section>
</div>
${SCRIPT}`;
}
