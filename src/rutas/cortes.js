import { aplicarCambios, cambiosConDatos, validarHoras } from '../servicioCortes.js';
import { listarCortes } from '../servicioParticipacion.js';
import { html, paginaAdmin, responder } from '../vistas.js';

export default async function rutasCortes(app) {
  const { db, datos } = app;

  const leerEntrada = (body, cortes) => Object.fromEntries(cortes.map((c) => [c.id, String(body?.[`hora_${c.id}`] ?? '')]));

  function pantalla(req, ctx, valores = null) {
    const cortes = listarCortes(db);
    const { real, demo } = datos.contarDatosPorCorte();
    const cuerpo = html`<form method="post" action="/admin/cortes" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <p class="nota">Cambia la hora de cada corte (HH:MM, en orden creciente). Es configuración compartida por los modos DEMO y REAL. No se pueden añadir ni quitar cortes.</p>
  ${cortes.map((c, i) => {
    const r = real.get(c.id) ?? 0;
    const d = demo.get(c.id) ?? 0;
    return html`<label for="hora_${c.id}">Corte ${i + 1}</label>
  <input id="hora_${c.id}" name="hora_${c.id}" type="time" required value="${valores?.[c.id] ?? c.hora}">
  ${r + d > 0 ? html`<p class="nota">Ya tiene datos: ${r} reales · ${d} de demo.</p>` : ''}`;
  })}
  <button type="submit" class="boton">Guardar horas</button>
</form>`;
    return paginaAdmin('Cortes horarios', ctx, cuerpo.texto);
  }

  app.get('/admin/cortes', async (req, reply) => responder(reply, pantalla(req, req.ctx())));

  app.post('/admin/cortes', async (req, reply) => {
    const cortes = listarCortes(db);
    const entrada = leerEntrada(req.body, cortes);
    const { errores, cambios } = validarHoras(cortes, entrada);
    if (errores.length > 0) return responder(reply, pantalla(req, req.ctx({ error: errores.join(' ') }), entrada), 422);
    if (cambios.length === 0) return reply.redirect('/admin/cortes?ok=cortes_sin_cambios');

    const afectados = cambiosConDatos(cambios, datos.contarDatosPorCorte());
    if (afectados.length > 0 && req.body?.confirmar !== '1') {
      const ctx = req.ctx();
      const cuerpo = html`<section class="tarjeta confirmar" role="alert">
  <h2>Hay datos en estos cortes</h2>
  <ul>${afectados.map((a) => html`<li>El corte de las <strong>${a.corte.hora}</strong> pasará a las <strong>${a.nueva}</strong> y ya tiene ${a.real} datos reales y ${a.demo} de demo.</li>`)}</ul>
  <p>Los datos no se modifican: seguirán asociados a ese corte, pero a otra hora. Avisa a los agentes si ya han empezado a introducirlos.</p>
  <form method="post" action="/admin/cortes" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    ${cortes.map((c) => html`<input type="hidden" name="hora_${c.id}" value="${entrada[c.id]}">`)}
    <input type="hidden" name="confirmar" value="1">
    <button type="submit" class="boton">Sí, cambiar las horas</button>
  </form>
  <p><a class="boton boton-sec" href="/admin/cortes">No, volver</a></p>
</section>`;
      return responder(reply, paginaAdmin('Confirmar cambio de horas', ctx, cuerpo.texto));
    }
    aplicarCambios(db, cambios, req.admin);
    return reply.redirect('/admin/cortes?ok=cortes_guardados');
  });
}
