import { verificarPasswordAdmin } from '../auth.js';
import { estaBloqueada, limpiarFallos, registrarFallo } from '../limiteIntentos.js';
import { DEMO, REAL } from '../modo.js';
import { fechaLarga, formatearMadrid } from '../tiempo.js';
import { html, paginaAdmin, responder } from '../vistas.js';

const normalizar = (texto) => String(texto ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

function motivo(estado) {
  const fecha = fechaLarga(estado.fechaElecciones);
  if (estado.origen === 'manual') {
    const aviso = estado.diaDeElecciones
      ? ''
      : ` Al llegar el ${fecha} (00:00, hora de Madrid) se anula y el modo pasa a REAL.`;
    return `Manual: fijado el ${formatearMadrid(estado.fijadoEn)}.${aviso}`;
  }
  return estado.modo === REAL
    ? `Automático: ha llegado la fecha de elecciones (${fecha}).`
    : `Automático: aún no ha llegado la fecha de elecciones; el ${fecha} a las 00:00 (hora de Madrid) pasará a REAL.`;
}

export default async function rutasModo(app) {
  const { db, datos } = app;

  const formulario = (ctx, destino, titulo, aviso, palabra, boton) => html`<section class="tarjeta">
  <h2>${titulo}</h2>
  <p>${aviso}</p>
  <form method="post" action="/admin/modo/cambiar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <input type="hidden" name="destino" value="${destino}">
    <label for="contrasena-${destino}">Contraseña de administrador</label>
    <input id="contrasena-${destino}" name="contrasena" type="password" autocomplete="current-password" required>
    <label for="palabra-${destino}">Escribe <strong>${palabra}</strong> para confirmar</label>
    <input id="palabra-${destino}" name="palabra" type="text" autocomplete="off" autocapitalize="characters" required>
    <button type="submit" class="boton">${boton}</button>
  </form>
</section>`;

  const pantalla = (ctx) => {
    const estado = datos.sincronizar();
    const perdidos = datos.contarRegistrosDemo();
    const enDemo = estado.modo === DEMO;
    const cuerpo = html`<section class="tarjeta">
  <p class="modo-actual ${enDemo ? 'modo-demo' : 'modo-real'}">Modo actual: <strong>${estado.modo}</strong></p>
  <p>${motivo(estado)}</p>
  <p>Fecha de elecciones: <strong>${fechaLarga(estado.fechaElecciones)}</strong></p>
  <p>Hora del servidor (Madrid): <strong>${formatearMadrid(estado.ahora)}</strong></p>
  <p class="nota">Comprueba que la hora del servidor es la de Madrid: de ella depende el cambio automático.</p>
</section>
${enDemo
  ? html`${formulario(
      ctx,
      REAL,
      'Pasar a REAL',
      perdidos > 0
        ? `Se eliminarán ${perdidos} registros de la demo. Los datos reales no se tocan.`
        : 'La demo no tiene datos. Los datos reales no se tocan.',
      'REAL',
      'Pasar a REAL'
    )}
<section class="tarjeta">
  <h2>Reiniciar demo</h2>
  <p>Borra los ${perdidos} registros de prueba y deja la demo vacía. No afecta a los datos reales.</p>
  <form method="post" action="/admin/modo/reiniciar-demo" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton boton-sec">Reiniciar demo</button>
  </form>
</section>`
  : formulario(
      ctx,
      DEMO,
      'Pasar a DEMO',
      estado.diaDeElecciones
        ? 'ATENCIÓN: ya ha llegado el día de las elecciones. En modo DEMO lo que se capture NO es dato real y se descartará al volver a REAL. Se registra en la auditoría.'
        : 'Lo que se capture en DEMO no es dato real y se descartará al volver a REAL.',
      estado.diaDeElecciones ? 'DEMO EN JORNADA' : 'DEMO',
      'Pasar a DEMO'
    )}`;
    return paginaAdmin('Modo de trabajo', ctx, cuerpo.texto);
  };

  app.get('/admin/modo', async (req, reply) => responder(reply, pantalla(req.ctx())));

  app.post('/admin/modo/cambiar', async (req, reply) => {
    const fallo = (error, codigo = 422) => responder(reply, pantalla(req.ctx({ error })), codigo);
    const destino = String(req.body.destino ?? '');
    if (destino !== DEMO && destino !== REAL) return fallo('Modo no válido.');
    if (datos.sincronizar().modo === destino) return fallo(`Ya estás en modo ${destino}.`, 409);

    if (estaBloqueada(db, 'admin', req.ip)) {
      return fallo('Demasiados intentos fallidos. Espera unos minutos o pide que desbloqueen tu IP.', 429);
    }
    if (!(await verificarPasswordAdmin(db, req.admin.id, String(req.body.contrasena ?? '')))) {
      registrarFallo(db, 'admin', req.ip);
      return fallo('La contraseña no es correcta.');
    }

    const palabra = normalizar(req.body.palabra);
    const enJornada = destino === DEMO && datos.sincronizar().diaDeElecciones;
    const esperada = destino === REAL ? 'REAL' : enJornada ? 'DEMO EN JORNADA' : 'DEMO';
    if (palabra !== esperada) return fallo(`Para confirmar, escribe exactamente ${esperada}.`);

    try {
      datos.cambiarModo(destino, req.admin, { enJornadaConfirmada: enJornada && palabra === 'DEMO EN JORNADA' });
    } catch (err) {
      return fallo(err.message, 409);
    }
    limpiarFallos(db, 'admin', req.ip);
    return reply.redirect('/admin/modo?ok=modo_cambiado');
  });

  app.post('/admin/modo/reiniciar-demo', async (req, reply) => {
    try {
      datos.reiniciarDemo(req.admin);
    } catch (err) {
      return responder(reply, pantalla(req.ctx({ error: err.message })), 409);
    }
    return reply.redirect('/admin/modo?ok=demo_reiniciada');
  });
}
