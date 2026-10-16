import {
  COLOR_DEFECTO, ErrorCandidatura, MAX_LOGO, borrarCandidatura, crearCandidatura, editarCandidatura, guardarLogo, hojaCandidaturas,
  leerCandidatura, listarCandidaturas, moverCandidatura, obtenerCandidatura, quitarLogo,
} from '../candidaturas.js';
import { estructuraBloqueada } from '../recuentoEstado.js';
import { crudo, html, paginaAdmin, recurso, responder } from '../vistas.js';
import { clase, insignia } from '../vistasCandidaturas.js';

const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp'];

export default async function rutasCandidaturas(app) {
  const { db, datos } = app;
  // Logo: cuerpo binario (PUT) sin dependencias de «multipart»; el límite lo impone Fastify.
  app.addContentTypeParser(TIPOS_LOGO, { parseAs: 'buffer', bodyLimit: MAX_LOGO + 1024 }, (req, body, done) => done(null, body));

  const idDe = (v) => (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const ctxHoja = (req, extra = {}) => req.ctx({ hojas: [hojaCandidaturas(db).url], ...extra });
  const bloqueada = (req) => estructuraBloqueada(db, req.modo.modo);
  const noEncontrada = (req, reply) =>
    responder(reply, paginaAdmin('Candidatura no encontrada', req.ctx(), '<p><a href="/admin/candidaturas">Volver a las candidaturas</a></p>'), 404);

  const avisoEstructura = (req) => {
    if (!bloqueada(req)) {
      return html`<p class="estado-estructura libre">Estructura editable. Se bloqueará al abrir el recuento por primera vez en REAL (o en DEMO, mientras se practique).</p>`;
    }
    return html`<p class="estado-estructura bloqueada" role="status">Recuento activado: la estructura (crear, borrar, activar, ordenar y destacar) está bloqueada. Siguen editables el nombre, las siglas, el color y el logo.${req.modo.modo === 'DEMO' ? ' Para desbloquear la demo: Modo → Reiniciar demo.' : ''}</p>`;
  };

  // ---------- Lista ----------
  app.get('/admin/candidaturas', async (req, reply) => {
    const lista = listarCandidaturas(db);
    const bloq = bloqueada(req);
    const ctx = ctxHoja(req);
    const cuerpo = html`<section class="tarjeta">
  ${avisoEstructura(req)}
  <p class="nota">Congreso · circunscripción de Madrid. El orden es el de la Junta Electoral Central.</p>
  <p class="nota">${lista.length} candidaturas · ${lista.filter((c) => c.activa).length} activas · ${lista.filter((c) => c.destacada).length} destacadas</p>
  ${bloq ? '' : html`<p><a class="boton" href="/admin/candidaturas/nueva">Añadir candidatura</a></p>`}
</section>
${lista.length === 0 ? html`<p>Todavía no hay candidaturas. Añádelas en el orden de la Junta Electoral Central.</p>` : ''}
<ol class="lista-cand">
  ${lista.map(
    (c, i) => html`<li class="cand-fila ${clase(c)}${c.activa ? '' : ' inactiva'}">
    <span class="orden">${c.orden}</span>
    ${insignia(c)}
    <span class="cand-datos">
      <span class="cand-siglas">${c.siglas || c.nombre}</span>
      ${c.siglas ? html`<span class="cand-nombre">${c.nombre}</span>` : ''}
      ${c.destacada ? html`<span class="etiqueta">Destacada</span>` : ''}
      ${c.activa ? '' : html`<span class="etiqueta gris">Inactiva</span>`}
    </span>
    <span class="cand-acciones">
      ${['subir', 'bajar'].map((sentido) => {
        const deshabilitado = bloq || (sentido === 'subir' ? i === 0 : i === lista.length - 1);
        return html`<form method="post" action="/admin/candidaturas/${c.id}/mover">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        <input type="hidden" name="sentido" value="${sentido}">
        <button type="submit" class="boton boton-sec boton-icono" aria-label="${sentido === 'subir' ? 'Subir' : 'Bajar'} ${c.siglas || c.nombre}"${deshabilitado ? crudo(' disabled') : ''}>${sentido === 'subir' ? '▲' : '▼'}</button>
      </form>`;
      })}
      <a class="boton boton-sec" href="/admin/candidaturas/${c.id}">Editar</a>
    </span>
  </li>`
  )}
</ol>`;
    return responder(reply, paginaAdmin('Candidaturas', ctx, cuerpo.texto));
  });

  // ---------- Formulario común (alta y edición) ----------
  function formulario(req, ctx, accion, v, { actual = null, posicion = '', boton }) {
    const bloq = bloqueada(req);
    const dis = bloq ? crudo(' disabled') : '';
    return html`<form method="post" action="${accion}" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  ${bloq ? '' : html`<input type="hidden" name="estructura" value="1">`}
  <label for="nombre">Nombre</label>
  <input id="nombre" name="nombre" type="text" required maxlength="80" autocomplete="off" value="${v.nombre}">
  <label for="siglas">Siglas (se ven en el clicker)</label>
  <input id="siglas" name="siglas" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" value="${v.siglas}">
  <label for="color">Color corporativo</label>
  <input id="color" name="color" type="color" class="selector-color" value="${v.color}">
  <label for="orden">Posición (orden de la Junta Electoral Central)</label>
  <input id="orden" name="posicion" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${posicion}"${dis}>
  <label class="casilla"><input type="checkbox" name="destacada" value="1"${v.destacada ? crudo(' checked') : ''}${dis}> Destacada (sale arriba en el pantallazo)</label>
  <label class="casilla"><input type="checkbox" name="activa" value="1"${v.activa ? crudo(' checked') : ''}${dis}> Activa (aparece en el formulario de recuento)</label>
  <button type="submit" class="boton">${boton}</button>
</form>`;
  }

  const posicionDe = (body) => (/^\d{1,3}$/.test(String(body.posicion ?? '').trim()) ? Number(body.posicion) : null);
  const valoresActuales = (c) => ({ nombre: c.nombre, siglas: c.siglas, color: c.color, destacada: c.destacada, activa: c.activa });

  // ---------- Alta ----------
  app.get('/admin/candidaturas/nueva', async (req, reply) => {
    const ctx = ctxHoja(req);
    const cuerpo = html`${avisoEstructura(req)}${bloqueada(req)
      ? html`<p><a href="/admin/candidaturas">Volver</a></p>`
      : formulario(req, ctx, '/admin/candidaturas', { nombre: '', siglas: '', color: COLOR_DEFECTO, destacada: 0, activa: 1 }, { boton: 'Crear candidatura' })}`;
    return responder(reply, paginaAdmin('Añadir candidatura', ctx, cuerpo.texto), bloqueada(req) ? 409 : 200);
  });

  app.post('/admin/candidaturas', async (req, reply) => {
    const { errores, valores } = leerCandidatura(req.body, { db });
    const falla = (mensajes, codigo = 422) => {
      const ctx = ctxHoja(req, { error: [].concat(mensajes).join(' ') });
      return responder(reply, paginaAdmin('Añadir candidatura', ctx, formulario(req, ctx, '/admin/candidaturas', valores, { posicion: String(req.body.posicion ?? ''), boton: 'Crear candidatura' }).texto), codigo);
    };
    if (errores.length) return falla(errores);
    try {
      crearCandidatura(db, { valores, posicion: posicionDe(req.body) }, req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidatura) return falla(e.mensajes, e.codigo);
      throw e;
    }
    return reply.redirect('/admin/candidaturas?ok=candidatura_creada');
  });

  // ---------- Edición ----------
  function pantallaEdicion(req, c, { valores = null, posicion = null, error = null } = {}) {
    const ctx = ctxHoja(req, { error });
    const v = valores ?? valoresActuales(c);
    const cuerpo = html`${avisoEstructura(req)}
${formulario(req, ctx, `/admin/candidaturas/${c.id}`, v, { actual: c, posicion: String(posicion ?? c.orden), boton: 'Guardar cambios' })}
<section class="tarjeta">
  <h2>Logo</h2>
  <p class="nota">PNG, JPEG o WebP, hasta ${MAX_LOGO / 1024} KB. Se muestra pequeño en el clicker y en el pantallazo. No se admite SVG.</p>
  <p class="logo-actual ${clase(c)}">${insignia(c)}</p>
  <label for="logo" class="boton boton-sec etiqueta-archivo">${c.tiene_logo ? 'Cambiar logo' : 'Subir logo'}</label>
  <input id="logo" class="archivo-logo" type="file" accept="image/png,image/jpeg,image/webp" data-url="/admin/candidaturas/${c.id}/logo" data-csrf="${ctx.csrf}" data-max="${MAX_LOGO}">
  <p id="estado-logo" class="nota" role="status"></p>
  ${c.tiene_logo
    ? html`<form method="post" action="/admin/candidaturas/${c.id}/logo/quitar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton boton-sec">Quitar logo</button>
  </form>`
    : ''}
</section>
${bloqueada(req) ? '' : html`<p><a class="boton boton-sec" href="/admin/candidaturas/${c.id}/borrar">Borrar candidatura…</a></p>`}
<p><a href="/admin/candidaturas">Volver a las candidaturas</a></p>
<script src="${recurso('/candidaturas.js')}" defer></script>`;
    return paginaAdmin(`Candidatura ${c.siglas || c.nombre}`, ctx, cuerpo.texto);
  }

  app.get('/admin/candidaturas/:id', async (req, reply) => {
    const c = obtenerCandidatura(db, idDe(req.params.id));
    return c ? responder(reply, pantallaEdicion(req, c)) : noEncontrada(req, reply);
  });

  app.post('/admin/candidaturas/:id', async (req, reply) => {
    const c = obtenerCandidatura(db, idDe(req.params.id));
    if (!c) return noEncontrada(req, reply);
    const conEstructura = req.body.estructura === '1';
    const { errores, valores } = leerCandidatura(req.body, { db, idActual: c.id });
    // Con la estructura bloqueada el formulario no la incluye: se conservan destacada y activa.
    if (!conEstructura) Object.assign(valores, { destacada: c.destacada, activa: c.activa });
    if (errores.length) return responder(reply, pantallaEdicion(req, c, { valores, posicion: req.body.posicion, error: errores.join(' ') }), 422);
    try {
      editarCandidatura(db, c.id, { valores, posicion: conEstructura ? posicionDe(req.body) : null }, req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidatura) return responder(reply, pantallaEdicion(req, c, { valores, posicion: req.body.posicion, error: e.mensajes.join(' ') }), e.codigo);
      throw e;
    }
    return reply.redirect('/admin/candidaturas?ok=candidatura_guardada');
  });

  app.post('/admin/candidaturas/:id/mover', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidatura(db, id)) return noEncontrada(req, reply);
    const sentido = req.body.sentido === 'bajar' ? 'bajar' : 'subir';
    try {
      moverCandidatura(db, id, sentido, req.admin, req.modo.modo);
    } catch (e) {
      if (e instanceof ErrorCandidatura) {
        const ctx = ctxHoja(req, { error: e.mensajes.join(' ') });
        return responder(reply, paginaAdmin('Candidaturas', ctx, '<p><a href="/admin/candidaturas">Volver a las candidaturas</a></p>'), e.codigo);
      }
      throw e;
    }
    return reply.redirect('/admin/candidaturas?ok=candidatura_movida');
  });

  // ---------- Borrado (con confirmación) ----------
  app.get('/admin/candidaturas/:id/borrar', async (req, reply) => {
    const c = obtenerCandidatura(db, idDe(req.params.id));
    if (!c) return noEncontrada(req, reply);
    const ctx = ctxHoja(req);
    const votos = datos.contarVotosPorCandidatura();
    const n = (votos.real.get(c.id) ?? 0) + (votos.demo.get(c.id) ?? 0);
    const cuerpo = bloqueada(req) || n > 0
      ? html`<p class="error" role="alert">${bloqueada(req) ? 'La estructura está bloqueada: no se pueden borrar candidaturas.' : 'Tiene votos: no se puede borrar, solo desactivar.'}</p><p><a href="/admin/candidaturas/${c.id}">Volver</a></p>`
      : html`<section class="tarjeta confirmar">
  <p>¿Borrar la candidatura <strong>${c.nombre}</strong>? No tiene votos. Queda registrado en la auditoría.</p>
  <form method="post" action="/admin/candidaturas/${c.id}/borrar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton">Sí, borrar</button>
  </form>
  <p><a class="boton boton-sec" href="/admin/candidaturas/${c.id}">No, volver</a></p>
</section>`;
    return responder(reply, paginaAdmin('Borrar candidatura', ctx, cuerpo.texto), bloqueada(req) || n > 0 ? 409 : 200);
  });

  app.post('/admin/candidaturas/:id/borrar', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidatura(db, id)) return noEncontrada(req, reply);
    try {
      borrarCandidatura(db, id, req.admin, req.modo.modo, datos.contarVotosPorCandidatura());
    } catch (e) {
      if (e instanceof ErrorCandidatura) {
        const ctx = ctxHoja(req, { error: e.mensajes.join(' ') });
        return responder(reply, paginaAdmin('Borrar candidatura', ctx, `<p><a href="/admin/candidaturas/${id}">Volver</a></p>`), e.codigo);
      }
      throw e;
    }
    return reply.redirect('/admin/candidaturas?ok=candidatura_borrada');
  });

  // ---------- Logo ----------
  app.put('/admin/candidaturas/:id/logo', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidatura(db, id)) return reply.code(404).send({ ok: false, error: 'Candidatura no encontrada.' });
    try {
      const hash = guardarLogo(db, id, req.body, req.admin);
      return reply.send({ ok: true, hash });
    } catch (e) {
      if (e instanceof ErrorCandidatura) return reply.code(e.codigo).send({ ok: false, error: e.message });
      throw e;
    }
  });

  app.post('/admin/candidaturas/:id/logo/quitar', async (req, reply) => {
    const id = idDe(req.params.id);
    if (!obtenerCandidatura(db, id)) return noEncontrada(req, reply);
    quitarLogo(db, id, req.admin);
    return reply.redirect(`/admin/candidaturas/${id}?ok=logo_quitado`);
  });
}
