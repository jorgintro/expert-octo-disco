import { POR_PAGINA, ACTORES, consultarHistorico, contextoNombres, describir, leerFiltros, nombreActor } from '../historico.js';
import { formatearMadrid } from '../tiempo.js';
import { html, paginaAdmin, responder } from '../vistas.js';

const ACCIONES = {
  crear: 'Crear', editar: 'Editar', vaciar: 'Vaciar', alta: 'Alta', baja: 'Baja', login: 'Inicio de sesión',
  generar_pin: 'Generar PIN', regenerar_pin: 'Regenerar PIN', revocar_pin: 'Revocar PIN',
  cambiar_modo: 'Cambio de modo (manual)', cambio_modo: 'Cambio de modo (automático)',
  anular_override_modo: 'Anular modo manual', reiniciar_demo: 'Reiniciar demo', desbloquear_ip: 'Desbloquear IP',
  cambiar_password: 'Cambiar contraseña', seed: 'Carga inicial',
};
const etiquetaAccion = (a) => ACCIONES[a] ?? a;

export default async function rutasHistorico(app) {
  const { db } = app;

  app.get('/admin/historico', async (req, reply) => {
    const filtros = leerFiltros(req.query);
    const h = consultarHistorico({ db, captura: req.captura, filtros });
    const nombres = contextoNombres(db);
    const mesas = db.prepare('SELECT id, codigo FROM mesa ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra').all();
    const acciones = h.acciones.includes(filtros.accion) || !filtros.accion ? h.acciones : [...h.acciones, filtros.accion];

    const enlace = (pagina) => {
      const q = new URLSearchParams();
      if (filtros.mesa) q.set('mesa', filtros.mesa);
      if (filtros.actor) q.set('actor', filtros.actor);
      if (filtros.accion) q.set('accion', filtros.accion);
      if (pagina > 1) q.set('pagina', pagina);
      const s = q.toString();
      return `/admin/historico${s ? `?${s}` : ''}`;
    };

    const cuerpo = html`<form method="get" action="/admin/historico" class="tarjeta formulario">
  <label for="mesa">Mesa</label>
  <select id="mesa" name="mesa">
    <option value="">Todas</option>
    ${mesas.map((m) => html`<option value="${m.id}"${m.id === filtros.mesa ? ' selected' : ''}>${m.codigo}</option>`)}
  </select>
  <label for="actor">Quién</label>
  <select id="actor" name="actor">
    <option value="">Todos</option>
    ${Object.entries(ACTORES).map(([k, v]) => html`<option value="${k}"${k === filtros.actor ? ' selected' : ''}>${v}</option>`)}
  </select>
  <label for="accion">Tipo de acción</label>
  <select id="accion" name="accion">
    <option value="">Todas</option>
    ${acciones.map((a) => html`<option value="${a}"${a === filtros.accion ? ' selected' : ''}>${etiquetaAccion(a)}</option>`)}
  </select>
  <button type="submit" class="boton">Filtrar</button>
  <a href="/admin/historico" class="boton boton-sec">Quitar filtros</a>
</form>
<p class="nota">${h.total} registros${req.captura.destino === 'demo' ? ' (configuración y captura de la DEMO; la captura real no se muestra en este modo)' : ''}. Hora de Madrid. Nunca se muestran PIN ni contraseñas.</p>
${h.filas.length === 0 ? html`<p>No hay registros con estos filtros.</p>` : ''}
${h.filas.map(
  (f) => html`<article class="entrada${f.origen === 'demo' ? ' entrada-demo' : ''}">
  <p class="entrada-cab"><time>${formatearMadrid(f.fecha)}</time>${f.origen === 'demo' ? html` <span class="etiqueta-demo">DEMO</span>` : ''}</p>
  <p><strong>${etiquetaAccion(f.accion)}</strong> · ${f.entidad} · ${nombreActor(f, nombres)}</p>
  <p class="detalle">${describir(f, nombres)}</p>
</article>`
)}
<nav class="paginacion" aria-label="Paginación">
  ${h.pagina > 1 ? html`<a class="boton boton-sec" href="${enlace(h.pagina - 1)}">« Anterior</a>` : html`<span></span>`}
  <span>Página ${h.pagina} de ${h.paginas}</span>
  ${h.pagina < h.paginas ? html`<a class="boton boton-sec" href="${enlace(h.pagina + 1)}">Siguiente »</a>` : html`<span></span>`}
</nav>`;
    return responder(reply, paginaAdmin('Histórico de cambios', req.ctx(), cuerpo.texto));
  });
}

export { POR_PAGINA };
