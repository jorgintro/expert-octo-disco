import { auditar } from '../auditoria.js';
import { borrarSesionesDeActor } from '../sesiones.js';
import { generarPin } from '../pin.js';
import { crudo, html, paginaAdmin, responder } from '../vistas.js';

const MAX_NOMBRE = 80;

function leerNombre(body) {
  const nombre = String(body.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (nombre === '') return { error: 'El nombre del agente es obligatorio.', nombre };
  if (nombre.length > MAX_NOMBRE) return { error: `El nombre no puede superar los ${MAX_NOMBRE} caracteres.`, nombre };
  return { nombre };
}

export default async function rutasAgentes(app) {
  const { db, config } = app;
  const obtener = (id) => (/^\d+$/.test(id) ? db.prepare('SELECT * FROM agente WHERE id = ?').get(Number(id)) : undefined);
  const mesasOrdenadas = () =>
    db.prepare('SELECT id, codigo, activa FROM mesa ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra').all();
  const codigosAsignados = (agenteId) =>
    db
      .prepare('SELECT m.codigo FROM agente_mesa am JOIN mesa m ON m.id = am.mesa_id WHERE am.agente_id = ? ORDER BY m.codigo')
      .all(agenteId)
      .map((f) => f.codigo);
  const idsAsignados = (agenteId) =>
    new Set(db.prepare('SELECT mesa_id FROM agente_mesa WHERE agente_id = ?').all(agenteId).map((f) => f.mesa_id));
  const estadoAgente = (a) => ({ nombre: a.nombre, activo: a.activo, tiene_pin: Boolean(a.pin_hmac) });
  const noEncontrado = (req, reply) =>
    responder(reply, paginaAdmin('Agente no encontrado', req.ctx(), '<p><a href="/admin/agentes">Volver a los agentes</a></p>'), 404);

  // Devuelve los ids de mesa marcados en el formulario, o un error si alguno no existe.
  function leerMesas(body) {
    const marcadas = [].concat(body.mesas ?? []).map(String);
    if (!marcadas.every((v) => /^\d+$/.test(v))) return { error: 'Selección de mesas no válida.' };
    const ids = [...new Set(marcadas.map(Number))];
    const validas = new Set(mesasOrdenadas().map((m) => m.id));
    if (!ids.every((id) => validas.has(id))) return { error: 'Alguna de las mesas seleccionadas no existe.' };
    return { ids };
  }

  const casillas = (seleccion) =>
    mesasOrdenadas().map(
      (m) => html`<label class="casilla"><input type="checkbox" name="mesas" value="${m.id}"${seleccion.has(m.id) ? crudo(' checked') : ''}> ${m.codigo}${m.activa ? '' : ' (de baja)'}</label>`
    );

  const formulario = (ctx, accion, nombre, seleccion, boton) => html`<form method="post" action="${accion}" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label for="nombre">Nombre</label>
  <input id="nombre" name="nombre" type="text" required maxlength="${MAX_NOMBRE}" autocomplete="off" value="${nombre}">
  <fieldset>
    <legend>Mesas asignadas</legend>
    ${casillas(seleccion)}
  </fieldset>
  <button type="submit" class="boton">${boton}</button>
</form>`;

  app.get('/admin/agentes', async (req, reply) => {
    const agentes = db.prepare('SELECT * FROM agente ORDER BY activo DESC, nombre COLLATE NOCASE').all();
    const cuerpo = html`<div class="tabla-scroll"><table>
  <thead><tr><th>Agente</th><th>Mesas</th><th>PIN</th></tr></thead>
  <tbody>
    ${agentes.map(
      (a) => html`<tr>
      <td><a href="/admin/agentes/${a.id}">${a.nombre}</a>${a.activo ? '' : ' (de baja)'}</td>
      <td>${codigosAsignados(a.id).join(', ') || '—'}</td>
      <td>${a.pin_hmac ? 'Sí' : 'No'}</td>
    </tr>`
    )}
  </tbody>
</table></div>
${agentes.length === 0 ? html`<p>Todavía no hay agentes.</p>` : ''}
<p><a class="boton" href="/admin/agentes/nuevo">Añadir agente</a></p>`;
    return responder(reply, paginaAdmin('Agentes y PIN', req.ctx(), cuerpo.texto));
  });

  app.get('/admin/agentes/nuevo', async (req, reply) => {
    const ctx = req.ctx();
    return responder(reply, paginaAdmin('Añadir agente', ctx, formulario(ctx, '/admin/agentes', '', new Set(), 'Crear agente').texto));
  });

  app.post('/admin/agentes', async (req, reply) => {
    const { nombre, error: errNombre } = leerNombre(req.body);
    const { ids, error: errMesas } = leerMesas(req.body);
    const error = errNombre ?? errMesas;
    if (error) {
      const ctx = req.ctx({ error });
      const sel = new Set([].concat(req.body.mesas ?? []).map(Number));
      return responder(reply, paginaAdmin('Añadir agente', ctx, formulario(ctx, '/admin/agentes', nombre, sel, 'Crear agente').texto), 422);
    }
    let nuevoId;
    db.transaction(() => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO agente (nombre, creado_en) VALUES (?, ?)')
        .run(nombre, new Date().toISOString());
      nuevoId = Number(lastInsertRowid);
      const asignar = db.prepare('INSERT INTO agente_mesa (agente_id, mesa_id) VALUES (?, ?)');
      ids.forEach((mesaId) => asignar.run(nuevoId, mesaId));
      auditar(db, req.admin, 'crear', 'agente', nuevoId, null, { nombre, activo: 1, mesas: codigosAsignados(nuevoId) });
    })();
    return reply.redirect(`/admin/agentes/${nuevoId}?ok=agente_creado`);
  });

  const pantallaAgente = (ctx, agente, nombre, seleccion) => {
    const pin = agente.activo
      ? html`<form method="post" action="/admin/agentes/${agente.id}/pin" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton">${agente.pin_hmac ? 'Regenerar PIN' : 'Generar PIN'}</button>
  </form>
  ${agente.pin_hmac
    ? html`<form method="post" action="/admin/agentes/${agente.id}/pin/revocar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton boton-sec">Revocar PIN</button>
  </form>`
    : ''}`
      : html`<p>El agente está de baja: no puede tener PIN.</p>`;
    const cuerpo = html`${formulario(ctx, `/admin/agentes/${agente.id}`, nombre, seleccion, 'Guardar cambios')}
<section class="tarjeta">
  <h2>PIN de acceso</h2>
  <p>${agente.pin_hmac ? 'Tiene un PIN activo (no se puede consultar: solo se muestra al generarlo).' : 'No tiene PIN.'}</p>
  ${pin}
</section>
<form method="post" action="/admin/agentes/${agente.id}/estado" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <button type="submit" class="boton boton-sec">${agente.activo ? 'Dar de baja al agente' : 'Dar de alta al agente'}</button>
</form>
<p><a href="/admin/agentes">Volver a los agentes</a></p>`;
    return paginaAdmin(`Agente: ${agente.nombre}`, ctx, cuerpo.texto);
  };

  app.get('/admin/agentes/:id', async (req, reply) => {
    const agente = obtener(req.params.id);
    if (!agente) return noEncontrado(req, reply);
    return responder(reply, pantallaAgente(req.ctx(), agente, agente.nombre, idsAsignados(agente.id)));
  });

  app.post('/admin/agentes/:id', async (req, reply) => {
    const agente = obtener(req.params.id);
    if (!agente) return noEncontrado(req, reply);
    const { nombre, error: errNombre } = leerNombre(req.body);
    const { ids, error: errMesas } = leerMesas(req.body);
    const error = errNombre ?? errMesas;
    if (error) {
      const sel = new Set([].concat(req.body.mesas ?? []).map(Number));
      return responder(reply, pantallaAgente(req.ctx({ error }), agente, nombre, sel), 422);
    }
    const antes = { nombre: agente.nombre, mesas: codigosAsignados(agente.id) };
    db.transaction(() => {
      db.prepare('UPDATE agente SET nombre = ? WHERE id = ?').run(nombre, agente.id);
      db.prepare('DELETE FROM agente_mesa WHERE agente_id = ?').run(agente.id);
      const asignar = db.prepare('INSERT INTO agente_mesa (agente_id, mesa_id) VALUES (?, ?)');
      ids.forEach((mesaId) => asignar.run(agente.id, mesaId));
      const despues = { nombre, mesas: codigosAsignados(agente.id) };
      if (JSON.stringify(antes) !== JSON.stringify(despues)) {
        auditar(db, req.admin, 'editar', 'agente', agente.id, antes, despues);
      }
    })();
    return reply.redirect(`/admin/agentes/${agente.id}?ok=agente_guardado`);
  });

  app.post('/admin/agentes/:id/pin', async (req, reply) => {
    const agente = obtener(req.params.id);
    if (!agente) return noEncontrado(req, reply);
    if (!agente.activo) {
      return responder(reply, pantallaAgente(req.ctx({ error: 'El agente está de baja.' }), agente, agente.nombre, idsAsignados(agente.id)), 409);
    }
    const { pin, hmac } = generarPin(db, config.pinHmacSecret);
    db.transaction(() => {
      db.prepare('UPDATE agente SET pin_hmac = ? WHERE id = ?').run(hmac, agente.id);
      borrarSesionesDeActor(db, 'agente', agente.id);
      // El PIN nunca se escribe en la auditoría.
      auditar(db, req.admin, agente.pin_hmac ? 'regenerar_pin' : 'generar_pin', 'agente', agente.id,
        { tiene_pin: Boolean(agente.pin_hmac) }, { tiene_pin: true });
    })();
    reply.header('Cache-Control', 'no-store');
    const cuerpo = html`<section class="tarjeta">
  <p>PIN de <strong>${agente.nombre}</strong>:</p>
  <p class="pin" aria-label="PIN">${pin}</p>
  <p>Anótalo y entrégaselo ahora: <strong>no se podrá volver a ver</strong>. Si se pierde, hay que regenerarlo.</p>
</section>
<p><a class="boton" href="/admin/agentes/${agente.id}">Volver al agente</a></p>`;
    return responder(reply, paginaAdmin('PIN generado', req.ctx(), cuerpo.texto));
  });

  app.post('/admin/agentes/:id/pin/revocar', async (req, reply) => {
    const agente = obtener(req.params.id);
    if (!agente) return noEncontrado(req, reply);
    if (agente.pin_hmac) {
      db.transaction(() => {
        db.prepare('UPDATE agente SET pin_hmac = NULL WHERE id = ?').run(agente.id);
        borrarSesionesDeActor(db, 'agente', agente.id);
        auditar(db, req.admin, 'revocar_pin', 'agente', agente.id, { tiene_pin: true }, { tiene_pin: false });
      })();
    }
    return reply.redirect(`/admin/agentes/${agente.id}?ok=pin_revocado`);
  });

  app.post('/admin/agentes/:id/estado', async (req, reply) => {
    const agente = obtener(req.params.id);
    if (!agente) return noEncontrado(req, reply);
    const activo = agente.activo ? 0 : 1;
    db.transaction(() => {
      // La baja invalida el PIN y las sesiones; el alta exige generar un PIN nuevo.
      db.prepare('UPDATE agente SET activo = ?, pin_hmac = CASE WHEN ? = 0 THEN NULL ELSE pin_hmac END WHERE id = ?')
        .run(activo, activo, agente.id);
      if (!activo) borrarSesionesDeActor(db, 'agente', agente.id);
      auditar(db, req.admin, activo ? 'alta' : 'baja', 'agente', agente.id, estadoAgente(agente),
        estadoAgente({ ...agente, activo, pin_hmac: activo ? agente.pin_hmac : null }));
    })();
    return reply.redirect(`/admin/agentes/${agente.id}?ok=${activo ? 'agente_alta' : 'agente_baja'}`);
  });
}
