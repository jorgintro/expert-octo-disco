import { construirHistorial } from '../participacion.js';
import { datosDeMesa, guardarDato, vaciarDato } from '../servicioParticipacion.js';
import { html, paginaAdmin, responder } from '../vistas.js';
import { autorDe, bloqueConfirmar, formularioDato, tablaHistorial } from '../vistasDato.js';

// Tabla mesa x corte donde el administrador introduce, corrige o vacía cualquier dato.
// (El panel resumen completo, con totales y %, llega en la 0.4.)
export default async function rutasParticipacion(app) {
  const { db } = app;
  const id = (v) => (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const noEncontrado = (req, reply) =>
    responder(reply, paginaAdmin('No encontrado', req.ctx(), '<p><a href="/admin/participacion">Volver a la tabla</a></p>'), 404);

  app.get('/admin/participacion', async (req, reply) => {
    const mesas = db
      .prepare('SELECT * FROM mesa ORDER BY activa DESC, CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra')
      .all();
    const cortes = db.prepare('SELECT id, hora FROM corte ORDER BY orden').all();
    const celdas = new Map(req.captura.listarParticipacion().map((f) => [`${f.mesa_id}:${f.corte_id}`, f]));
    const cuerpo = html`<p class="nota">Toca una celda para introducir, corregir o vaciar el dato de esa mesa y corte.</p>
<div class="tabla-scroll"><table class="tabla-participacion">
  <thead><tr><th>Mesa</th>${cortes.map((c) => html`<th class="num">${c.hora}</th>`)}</tr></thead>
  <tbody>
    ${mesas.map(
      (m) => html`<tr${m.activa ? '' : html` class="vacia"`}>
      <th scope="row">${m.codigo}${m.activa ? '' : html`<br><span class="nota">de baja</span>`}</th>
      ${cortes.map((c) => {
        const f = celdas.get(`${m.id}:${c.id}`);
        return html`<td class="num"><a class="celda" href="/admin/participacion/${m.id}/${c.id}">${f ? f.votantes_acumulados : '—'}${f?.introducido_por_tipo === 'admin' ? html` <span class="marca-admin" title="Introducido por el administrador">A</span>` : ''}</a></td>`;
      })}
    </tr>`
    )}
  </tbody>
</table></div>
<p class="nota">Acumulado de votantes. <span class="marca-admin">A</span> = introducido por el administrador (los agentes no pueden modificarlo).</p>`;
    return responder(reply, paginaAdmin('Participación', req.ctx(), cuerpo.texto));
  });

  function pantallaCelda(req, mesaId, corteId, { valor = null, error = null, confirmacion = null } = {}) {
    const datos = datosDeMesa(db, req.captura, mesaId);
    const corte = datos?.cortes.find((c) => c.id === corteId);
    if (!datos || !corte) return null;
    const fila = datos.filas.find((f) => f.corte_id === corteId);
    const accion = `/admin/participacion/${mesaId}/${corteId}`;
    const ctx = req.ctx({ error });
    const cuerpo = html`<section class="tarjeta">
  <p class="nota">Censo: <strong>${datos.mesa.censo}</strong> electores${datos.mesa.activa ? '' : ' · mesa de baja'}</p>
  <p>${fila ? html`Dato actual: <strong>${fila.votantes_acumulados}</strong><br><span class="nota">Introducido por ${autorDe(db, fila)}</span>` : 'Todavía no hay dato.'}</p>
  ${confirmacion
    ? bloqueConfirmar({ csrf: ctx.csrf, accion, valor: confirmacion.valor, avisos: confirmacion.avisos, urlCorregir: accion })
    : formularioDato({ csrf: ctx.csrf, accion, valor: valor ?? (fila ? String(fila.votantes_acumulados) : ''), boton: 'Guardar como administrador' })}
</section>
${fila && !confirmacion ? html`<p><a class="boton boton-sec" href="${accion}/vaciar">Vaciar este dato</a></p>` : ''}
<h2>Histórico de la mesa</h2>
${tablaHistorial({ filas: construirHistorial({ cortes: datos.cortes, filas: datos.filas, censo: datos.mesa.censo }) })}
<p><a href="/admin/participacion">Volver a la tabla</a></p>`;
    return paginaAdmin(`Mesa ${datos.mesa.codigo} · ${corte.hora}`, ctx, cuerpo.texto);
  }

  app.get('/admin/participacion/:mesa/:corte', async (req, reply) => {
    const pagina = pantallaCelda(req, id(req.params.mesa), id(req.params.corte));
    return pagina ? responder(reply, pagina) : noEncontrado(req, reply);
  });

  app.post('/admin/participacion/:mesa/:corte', async (req, reply) => {
    const [mesaId, corteId] = [id(req.params.mesa), id(req.params.corte)];
    const texto = String(req.body.votantes ?? '');
    const r = guardarDato({
      db, captura: req.captura, actor: req.admin, mesaId, corteId, texto,
      confirmar: req.body.confirmar === '1', ahora: req.modo.ahora, modo: req.modo.modo,
    });
    if (r.estado === 'no_encontrado') return noEncontrado(req, reply);
    if (r.estado === 'error') return responder(reply, pantallaCelda(req, mesaId, corteId, { valor: texto, error: r.errores.join(' ') }), 422);
    if (r.estado === 'confirmar') return responder(reply, pantallaCelda(req, mesaId, corteId, { confirmacion: r }));
    return reply.redirect(`/admin/participacion?ok=${r.estado === 'guardado' ? 'dato_guardado' : 'dato_sin_cambios'}`);
  });

  app.get('/admin/participacion/:mesa/:corte/vaciar', async (req, reply) => {
    const [mesaId, corteId] = [id(req.params.mesa), id(req.params.corte)];
    const datos = datosDeMesa(db, req.captura, mesaId);
    const fila = datos?.filas.find((f) => f.corte_id === corteId);
    if (!datos || !fila) return noEncontrado(req, reply);
    const corte = datos.cortes.find((c) => c.id === corteId);
    const ctx = req.ctx();
    const cuerpo = html`<section class="tarjeta confirmar">
  <p>¿Vaciar el dato <strong>${fila.votantes_acumulados}</strong> de la mesa <strong>${datos.mesa.codigo}</strong> a las <strong>${corte.hora}</strong>?</p>
  <p class="nota">Introducido por ${autorDe(db, fila)}. Queda registrado en la auditoría.</p>
  <form method="post" action="/admin/participacion/${mesaId}/${corteId}/vaciar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton">Sí, vaciar</button>
  </form>
  <p><a class="boton boton-sec" href="/admin/participacion/${mesaId}/${corteId}">No, volver</a></p>
</section>`;
    return responder(reply, paginaAdmin('Vaciar dato', ctx, cuerpo.texto));
  });

  app.post('/admin/participacion/:mesa/:corte/vaciar', async (req, reply) => {
    const r = vaciarDato({ db, captura: req.captura, actor: req.admin, mesaId: id(req.params.mesa), corteId: id(req.params.corte) });
    if (r.estado === 'no_encontrado') return noEncontrado(req, reply);
    return reply.redirect('/admin/participacion?ok=dato_vaciado');
  });
}
