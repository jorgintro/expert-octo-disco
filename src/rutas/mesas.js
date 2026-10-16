import { auditar } from '../auditoria.js';
import { html, paginaAdmin, responder } from '../vistas.js';

function leerMesa(body) {
  const crudo = {
    distrito: String(body.distrito ?? '').trim(),
    seccion: String(body.seccion ?? '').trim(),
    letra: String(body.letra ?? '').trim().toUpperCase(),
    censo: String(body.censo ?? '').trim(),
  };
  const errores = [];
  if (!/^\d{1,3}$/.test(crudo.distrito)) errores.push('El distrito debe ser un número de hasta 3 cifras.');
  if (!/^\d{1,3}$/.test(crudo.seccion)) errores.push('La sección debe ser un número de hasta 3 cifras.');
  if (!/^[A-Z0-9]{1,3}$/.test(crudo.letra)) errores.push('La mesa debe ser una letra o número (hasta 3 caracteres).');
  if (!/^\d{1,6}$/.test(crudo.censo)) errores.push('El censo debe ser un número entero mayor o igual que 0.');
  if (errores.length) return { errores, valores: crudo };

  const valores = {
    distrito: String(Number(crudo.distrito)),
    seccion: String(Number(crudo.seccion)),
    letra: crudo.letra,
    censo: Number(crudo.censo),
  };
  return { errores, valores };
}

const codigoDe = (v) => `${v.distrito}-${v.seccion}-${v.letra}`;
const estadoMesa = (m) => ({ codigo: m.codigo, censo: m.censo, activa: m.activa });

function formulario(ctx, accion, v, boton) {
  return html`<form method="post" action="${accion}" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label for="distrito">Distrito</label>
  <input id="distrito" name="distrito" type="text" inputmode="numeric" required maxlength="3" value="${v.distrito}">
  <label for="seccion">Sección</label>
  <input id="seccion" name="seccion" type="text" inputmode="numeric" required maxlength="3" value="${v.seccion}">
  <label for="letra">Mesa (letra)</label>
  <input id="letra" name="letra" type="text" autocapitalize="characters" required maxlength="3" value="${v.letra}">
  <label for="censo">Censo</label>
  <input id="censo" name="censo" type="text" inputmode="numeric" required maxlength="6" value="${v.censo}">
  <button type="submit" class="boton">${boton}</button>
</form>`;
}

export default async function rutasMesas(app) {
  const { db } = app;
  const colegio = () => db.prepare('SELECT id FROM colegio ORDER BY id LIMIT 1').get();
  const obtener = (id) => (/^\d+$/.test(id) ? db.prepare('SELECT * FROM mesa WHERE id = ?').get(Number(id)) : undefined);
  const duplicada = (colegioId, codigo, exceptoId = 0) =>
    db.prepare('SELECT 1 FROM mesa WHERE colegio_id = ? AND codigo = ? AND id != ?').get(colegioId, codigo, exceptoId);
  const noEncontrada = (req, reply) =>
    responder(reply, paginaAdmin('Mesa no encontrada', req.ctx(), '<p><a href="/admin/mesas">Volver a las mesas</a></p>'), 404);

  app.get('/admin/mesas', async (req, reply) => {
    const mesas = db
      .prepare('SELECT * FROM mesa ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra')
      .all();
    const total = mesas.filter((m) => m.activa).reduce((suma, m) => suma + m.censo, 0);
    const cuerpo = html`<div class="tabla-scroll"><table>
  <thead><tr><th>Mesa</th><th class="num">Censo</th><th>Estado</th></tr></thead>
  <tbody>
    ${mesas.map(
      (m) => html`<tr>
      <td><a href="/admin/mesas/${m.id}">${m.codigo}</a></td>
      <td class="num">${m.censo}</td>
      <td>${m.activa ? 'Activa' : 'De baja'}</td>
    </tr>`
    )}
  </tbody>
  <tfoot><tr><th>Total activas</th><th class="num">${total}</th><th></th></tr></tfoot>
</table></div>
<p><a class="boton" href="/admin/mesas/nueva">Añadir mesa</a></p>`;
    return responder(reply, paginaAdmin('Mesas y censo', req.ctx(), cuerpo.texto));
  });

  app.get('/admin/mesas/nueva', async (req, reply) => {
    const ctx = req.ctx();
    const vacia = { distrito: '', seccion: '', letra: '', censo: '' };
    return responder(reply, paginaAdmin('Añadir mesa', ctx, formulario(ctx, '/admin/mesas', vacia, 'Crear mesa').texto));
  });

  app.post('/admin/mesas', async (req, reply) => {
    const { errores, valores } = leerMesa(req.body);
    const col = colegio();
    const codigo = codigoDe(valores);
    if (!errores.length && duplicada(col.id, codigo)) errores.push(`Ya existe la mesa ${codigo}.`);
    if (errores.length) {
      const ctx = req.ctx({ error: errores.join(' ') });
      return responder(reply, paginaAdmin('Añadir mesa', ctx, formulario(ctx, '/admin/mesas', valores, 'Crear mesa').texto), 422);
    }
    db.transaction(() => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO mesa (colegio_id, distrito, seccion, letra, codigo, censo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(col.id, valores.distrito, valores.seccion, valores.letra, codigo, valores.censo);
      auditar(db, req.admin, 'crear', 'mesa', Number(lastInsertRowid), null, { codigo, censo: valores.censo, activa: 1 });
    })();
    return reply.redirect('/admin/mesas?ok=creada');
  });

  const pantallaEdicion = (ctx, mesa, valores) => {
    const cuerpo = html`${formulario(ctx, `/admin/mesas/${mesa.id}`, valores, 'Guardar cambios')}
<form method="post" action="/admin/mesas/${mesa.id}/estado" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <button type="submit" class="boton boton-sec">${mesa.activa ? 'Dar de baja la mesa' : 'Dar de alta la mesa'}</button>
</form>
<p><a href="/admin/mesas">Volver a las mesas</a></p>`;
    return paginaAdmin(`Mesa ${mesa.codigo}`, ctx, cuerpo.texto);
  };

  app.get('/admin/mesas/:id', async (req, reply) => {
    const mesa = obtener(req.params.id);
    if (!mesa) return noEncontrada(req, reply);
    return responder(reply, pantallaEdicion(req.ctx(), mesa, { ...mesa, censo: String(mesa.censo) }));
  });

  app.post('/admin/mesas/:id', async (req, reply) => {
    const mesa = obtener(req.params.id);
    if (!mesa) return noEncontrada(req, reply);
    const { errores, valores } = leerMesa(req.body);
    const codigo = codigoDe(valores);
    if (!errores.length && duplicada(mesa.colegio_id, codigo, mesa.id)) errores.push(`Ya existe la mesa ${codigo}.`);
    if (errores.length) {
      return responder(reply, pantallaEdicion(req.ctx({ error: errores.join(' ') }), mesa, valores), 422);
    }
    const nueva = { ...mesa, ...valores, codigo };
    const cambia = ['distrito', 'seccion', 'letra', 'censo'].some((campo) => nueva[campo] !== mesa[campo]);
    if (cambia) {
      db.transaction(() => {
        db.prepare('UPDATE mesa SET distrito = ?, seccion = ?, letra = ?, codigo = ?, censo = ? WHERE id = ?').run(
          valores.distrito, valores.seccion, valores.letra, codigo, valores.censo, mesa.id
        );
        auditar(db, req.admin, 'editar', 'mesa', mesa.id, estadoMesa(mesa), estadoMesa(nueva));
      })();
    }
    return reply.redirect('/admin/mesas?ok=guardada');
  });

  app.post('/admin/mesas/:id/estado', async (req, reply) => {
    const mesa = obtener(req.params.id);
    if (!mesa) return noEncontrada(req, reply);
    const activa = mesa.activa ? 0 : 1;
    db.transaction(() => {
      db.prepare('UPDATE mesa SET activa = ? WHERE id = ?').run(activa, mesa.id);
      auditar(db, req.admin, activa ? 'alta' : 'baja', 'mesa', mesa.id, estadoMesa(mesa), estadoMesa({ ...mesa, activa }));
    })();
    return reply.redirect(`/admin/mesas?ok=${activa ? 'alta' : 'baja'}`);
  });
}
