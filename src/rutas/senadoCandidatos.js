import { hojaCandidaturas, listarCandidaturas } from '../candidaturas.js';
import {
  ErrorCandidato, borrarCandidato, crearCandidato, editarCandidato, leerCandidato, listarCandidatos, moverCandidato, obtenerCandidato,
} from '../candidatosSenado.js';
import { estructuraSenadoBloqueada } from '../recuentoEstado.js';
import { agruparEnListas } from '../senado.js';
import { crudo, html, paginaAdmin, responder } from '../vistas.js';
import { insigniaCandidato } from '../vistasSenado.js';

const COLOR_DEFECTO = '#546e7a';

// Candidatos del Senado (administración): alta, edición, orden, activar/desactivar y partido asociado.
export default async function rutasSenadoCandidatos(app) {
  const { db, datos } = app;
  const idDe = (v) => (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const ctxHoja = (req, extra = {}) => req.ctx({ hojas: [hojaCandidaturas(db).url], ...extra });
  const bloqueada = (req) => estructuraSenadoBloqueada(db, req.modo.modo);
  const noEncontrado = (req, reply) =>
    responder(reply, paginaAdmin('Candidato no encontrado', req.ctx(), '<p><a href="/admin/senado/candidatos">Volver a los candidatos</a></p>'), 404);

  const avisoEstructura = (req) =>
    bloqueada(req)
      ? html`<p class="estado-estructura bloqueada" role="status">Recuento del Senado activado: la estructura (alta, borrado, orden y activo) está bloqueada. Siguen editables el nombre, el partido, la agrupación y el color.${req.modo.modo === 'DEMO' ? ' Para desbloquear la demo: Modo → Reiniciar demo.' : ''}</p>`
      : html`<p class="estado-estructura libre">Estructura editable. Se bloqueará al abrir el recuento del Senado por primera vez en REAL (o en DEMO, mientras se practique).</p>`;

  // ---------- Lista ----------
  app.get('/admin/senado/candidatos', async (req, reply) => {
    const lista = listarCandidatos(db);
    const bloq = bloqueada(req);
    const ctx = ctxHoja(req);
    const listas = agruparEnListas(lista);
    const cuerpo = html`<section class="tarjeta">
  ${avisoEstructura(req)}
  <p class="nota">Senado · circunscripción de Madrid. Se eligen 4 senadores; cada elector marca hasta 3 nombres. El orden es el de la papeleta.</p>
  <p class="nota">${lista.length} candidatos · ${lista.filter((c) => c.activo).length} activos · ${listas.length} listas</p>
  ${bloq ? '' : html`<p><a class="boton" href="/admin/senado/candidatos/nuevo">Añadir candidato</a></p>`}
</section>
${lista.length === 0 ? html`<p>Todavía no hay candidatos. Añádelos en el orden de la papeleta cuando se publiquen las listas.</p>` : ''}
<ol class="lista-cand">
  ${lista.map(
    (c, i) => html`<li class="cand-fila cs-${c.id}${c.activo ? '' : ' inactiva'}">
    <span class="orden">${c.orden}</span>
    ${insigniaCandidato(c)}
    <span class="cand-datos">
      <span class="cand-siglas">${c.nombre}</span>
      <span class="cand-nombre">${c.partido_siglas || c.partido_nombre || c.agrupacion || 'Sin partido ni agrupación'}</span>
      ${c.activo ? '' : html`<span class="etiqueta gris">Inactivo</span>`}
    </span>
    <span class="cand-acciones">
      ${['subir', 'bajar'].map((sentido) => {
        const deshabilitado = bloq || (sentido === 'subir' ? i === 0 : i === lista.length - 1);
        return html`<form method="post" action="/admin/senado/candidatos/${c.id}/mover">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        <input type="hidden" name="sentido" value="${sentido}">
        <button type="submit" class="boton boton-sec boton-icono" aria-label="${sentido === 'subir' ? 'Subir' : 'Bajar'} ${c.nombre}"${deshabilitado ? crudo(' disabled') : ''}>${sentido === 'subir' ? '▲' : '▼'}</button>
      </form>`;
      })}
      <a class="boton boton-sec" href="/admin/senado/candidatos/${c.id}">Editar</a>
    </span>
  </li>`
  )}
</ol>
<p><a href="/admin/senado">Volver al recuento del Senado</a></p>`;
    return responder(reply, paginaAdmin('Candidatos del Senado', ctx, cuerpo.texto));
  });

  // ---------- Formulario común ----------
  function formulario(req, ctx, accion, v, { posicion = '', boton }) {
    const bloq = bloqueada(req);
    const dis = bloq ? crudo(' disabled') : '';
    const partidos = listarCandidaturas(db);
    return html`<form method="post" action="${accion}" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  ${bloq ? '' : html`<input type="hidden" name="estructura" value="1">`}
  <label for="nombre">Nombre del candidato</label>
  <input id="nombre" name="nombre" type="text" required maxlength="80" autocomplete="off" value="${v.nombre}">
  <label for="candidatura_id">Partido (candidatura del Congreso)</label>
  <select id="candidatura_id" name="candidatura_id">
    <option value="">Sin partido (agrupación propia)</option>
    ${partidos.map((p) => html`<option value="${p.id}"${p.id === v.candidatura_id ? crudo(' selected') : ''}>${p.siglas ? `${p.siglas} · ` : ''}${p.nombre}</option>`)}
  </select>
  <p class="nota">Con partido, el candidato hereda su color y su logo, y forma lista con los demás de ese partido. Cambiar el partido no recalcula la estadística de bloque ya contada.</p>
  <label for="agrupacion">Agrupación (solo si no tiene partido; mismo texto = misma lista)</label>
  <input id="agrupacion" name="agrupacion" type="text" maxlength="60" autocomplete="off" value="${v.agrupacion}">
  <label for="color">Color propio (solo si no tiene partido)</label>
  <input id="color" name="color" type="color" class="selector-color" value="${v.color}">
  <label for="orden">Posición en la papeleta</label>
  <input id="orden" name="posicion" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${posicion}"${dis}>
  <label class="casilla"><input type="checkbox" name="activo" value="1"${v.activo ? crudo(' checked') : ''}${dis}> Activo (aparece en la papeleta de recuento)</label>
  <button type="submit" class="boton">${boton}</button>
</form>`;
  }

  const posicionDe = (body) => (/^\d{1,3}$/.test(String(body.posicion ?? '').trim()) ? Number(body.posicion) : null);
  const valoresActuales = (c) => ({ nombre: c.nombre, candidatura_id: c.candidatura_id, agrupacion: c.agrupacion, color: c.color, activo: c.activo });
  const VACIO_V = { nombre: '', candidatura_id: null, agrupacion: '', color: COLOR_DEFECTO, activo: 1 };

  // ---------- Alta ----------
  app.get('/admin/senado/candidatos/nuevo', async (req, reply) => {
    const ctx = ctxHoja(req);
    const cuerpo = html`${avisoEstructura(req)}${bloqueada(req)
      ? html`<p><a href="/admin/senado/candidatos">Volver</a></p>`
      : formulario(req, ctx, '/admin/senado/candidatos', VACIO_V, { boton: 'Crear candidato' })}`;
    return responder(reply, paginaAdmin('Añadir candidato', ctx, cuerpo.texto), bloqueada(req) ? 409 : 200);
  });

  app.post('/admin/senado/candidatos', async (req, reply) => {
    const { errores, valores } = leerCandidato(req.body, { db });
    const falla = (mensajes, codigo = 422) => {
      const ctx = ctxHoja(req, { error: [].concat(mensajes).join(' ') });
      return responder(reply, paginaAdmin('Añadir candidato', ctx, formulario(req, ctx, '/admin/senado/candidatos', valores, { posicion: String(req.body.posicion ?? ''), boton: 'Crear candidato' }).texto), codigo);
    };
    if (errores.length) return falla(errores);
    try {
      crearCandidato(db, { valores, posicion: posicionDe(req.body) }, req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidato) return falla(e.mensajes, e.codigo);
      throw e;
    }
    return reply.redirect('/admin/senado/candidatos?ok=candidato_creado');
  });

  // ---------- Edición ----------
  function pantallaEdicion(req, c, { valores = null, posicion = null, error = null } = {}) {
    const ctx = ctxHoja(req, { error });
    const cuerpo = html`${avisoEstructura(req)}
${formulario(req, ctx, `/admin/senado/candidatos/${c.id}`, valores ?? valoresActuales(c), { posicion: String(posicion ?? c.orden), boton: 'Guardar cambios' })}
${bloqueada(req) ? '' : html`<p><a class="boton boton-sec" href="/admin/senado/candidatos/${c.id}/borrar">Borrar candidato…</a></p>`}
<p><a href="/admin/senado/candidatos">Volver a los candidatos</a></p>`;
    return paginaAdmin(`Candidato ${c.nombre}`, ctx, cuerpo.texto);
  }

  app.get('/admin/senado/candidatos/:id', async (req, reply) => {
    const c = obtenerCandidato(db, idDe(req.params.id));
    return c ? responder(reply, pantallaEdicion(req, c)) : noEncontrado(req, reply);
  });

  app.post('/admin/senado/candidatos/:id', async (req, reply) => {
    const c = obtenerCandidato(db, idDe(req.params.id));
    if (!c) return noEncontrado(req, reply);
    const conEstructura = req.body.estructura === '1';
    const { errores, valores } = leerCandidato(req.body, { db, idActual: c.id });
    if (!conEstructura) valores.activo = c.activo; // con la estructura bloqueada el formulario no la incluye
    if (errores.length) return responder(reply, pantallaEdicion(req, c, { valores, posicion: req.body.posicion, error: errores.join(' ') }), 422);
    try {
      editarCandidato(db, c.id, { valores, posicion: conEstructura ? posicionDe(req.body) : null }, req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidato) return responder(reply, pantallaEdicion(req, c, { valores, posicion: req.body.posicion, error: e.mensajes.join(' ') }), e.codigo);
      throw e;
    }
    return reply.redirect('/admin/senado/candidatos?ok=candidato_guardado');
  });

  app.post('/admin/senado/candidatos/:id/mover', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidato(db, id)) return noEncontrado(req, reply);
    try {
      moverCandidato(db, id, req.body.sentido === 'bajar' ? 'bajar' : 'subir', req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidato) {
        const ctx = ctxHoja(req, { error: e.mensajes.join(' ') });
        return responder(reply, paginaAdmin('Candidatos del Senado', ctx, '<p><a href="/admin/senado/candidatos">Volver a los candidatos</a></p>'), e.codigo);
      }
      throw e;
    }
    return reply.redirect('/admin/senado/candidatos?ok=candidato_movido');
  });

  // ---------- Borrado (con confirmación) ----------
  app.get('/admin/senado/candidatos/:id/borrar', async (req, reply) => {
    const c = obtenerCandidato(db, idDe(req.params.id));
    if (!c) return noEncontrado(req, reply);
    const ctx = ctxHoja(req);
    const votos = datos.contarVotosPorCandidato();
    const n = (votos.real.get(c.id) ?? 0) + (votos.demo.get(c.id) ?? 0);
    const impedido = bloqueada(req) || n > 0;
    const cuerpo = impedido
      ? html`<p class="error" role="alert">${bloqueada(req) ? 'La estructura está bloqueada: no se pueden borrar candidatos.' : 'Tiene votos: no se puede borrar, solo desactivar.'}</p><p><a href="/admin/senado/candidatos/${c.id}">Volver</a></p>`
      : html`<section class="tarjeta confirmar">
  <p>¿Borrar al candidato <strong>${c.nombre}</strong>? No tiene votos. Queda registrado en la auditoría.</p>
  <form method="post" action="/admin/senado/candidatos/${c.id}/borrar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton">Sí, borrar</button>
  </form>
  <p><a class="boton boton-sec" href="/admin/senado/candidatos/${c.id}">No, volver</a></p>
</section>`;
    return responder(reply, paginaAdmin('Borrar candidato', ctx, cuerpo.texto), impedido ? 409 : 200);
  });

  app.post('/admin/senado/candidatos/:id/borrar', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidato(db, id)) return noEncontrado(req, reply);
    try {
      borrarCandidato(db, id, req.admin, req.modo.modo, datos.contarVotosPorCandidato());
    } catch (e) {
      if (e instanceof ErrorCandidato) {
        const ctx = ctxHoja(req, { error: e.mensajes.join(' ') });
        return responder(reply, paginaAdmin('Borrar candidato', ctx, `<p><a href="/admin/senado/candidatos/${id}">Volver</a></p>`), e.codigo);
      }
      throw e;
    }
    return reply.redirect('/admin/senado/candidatos?ok=candidato_borrado');
  });
}
