import { listarCandidaturas, hojaCandidaturas } from '../candidaturas.js';
import { codigoHttp, entradaDeBody, esPeticionFetch, jsonDeResultado, valoresDeEntrada, versionDeBody } from '../entradaRecuento.js';
import { construirResumenRecuento } from '../recuento.js';
import { recuentoAbierto } from '../recuentoEstado.js';
import { abrirRecuento, cerrarRecuento, comprobarApertura } from '../servicioApertura.js';
import { cargarMesaRecuento, guardarRecuentoMesa, reabrirRecuentoMesa } from '../servicioRecuento.js';
import { formatearMadrid } from '../tiempo.js';
import { html, paginaAdmin, recurso, responder } from '../vistas.js';
import { pestanas } from '../vistasSenado.js';
import { bloqueConfirmarCierre, formularioRecuento, matrizRecuento, resultadosRecuento, valoresDeDatos } from '../vistasRecuento.js';

// Panel del recuento del Congreso (administrador): apertura, resultados, matriz por mesa y ficha de cada mesa.
export default async function rutasRecuento(app) {
  const { db } = app;
  const idDe = (v) => (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const ctxHoja = (req, extra = {}) => req.ctx({ hojas: [hojaCandidaturas(db).url], ...extra });

  const cargarResumen = (req) => {
    const mesas = db.prepare('SELECT id, codigo, censo FROM mesa WHERE activa = 1 ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra').all();
    return construirResumenRecuento({ mesas, candidaturas: listarCandidaturas(db), recuentos: req.captura.listarRecuentos() });
  };

  // ---------- Panel ----------
  function panel(req, ctx, { confirmacion = null } = {}) {
    const modo = req.modo.modo;
    const abierto = recuentoAbierto(db, modo);
    const resumen = cargarResumen(req);
    const apertura = comprobarApertura({ db, captura: req.captura, modo, ahora: req.modo.ahora });
    const [fecha, hora] = formatearMadrid(req.modo.ahora).split(' ');
    const sello = resumen.provisional
      ? html`<p class="sello provisional">PROVISIONAL · ${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas</p>`
      : html`<p class="sello completo">COMPLETO · ${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas</p>`;
    const cuerpo = html`${pestanas({ congresoUrl: '/admin/recuento', senadoUrl: '/admin/senado', activa: 'congreso' })}<section class="tarjeta">
  <p class="estado-recuento ${abierto ? 'abierto' : 'cerrado'}">Recuento ${modo === 'DEMO' ? '(demo) ' : ''}<strong>${abierto ? 'ABIERTO' : 'CERRADO'}</strong></p>
  <p class="nota">Actualizado: <time id="hora-actualizacion">${hora}</time> · ${fecha} · hora de Madrid</p>
  <p class="aviso-sin-conexion" role="alert">SIN CONEXIÓN · los datos son de las ${hora}</p>
  ${confirmacion ?? ''}
  ${abierto
    ? html`<form method="post" action="/admin/recuento/cerrar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton boton-sec">Cerrar el recuento</button>
  </form>`
    : html`${apertura.motivos.length > 0
      ? html`<div class="error" role="alert"><p>No se puede abrir todavía:</p><ul>${apertura.motivos.map((m) => html`<li>${m}</li>`)}</ul></div>`
      : ''}
  <form method="post" action="/admin/recuento/abrir" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton"${apertura.ok ? '' : ' disabled'}>Abrir el recuento</button>
  </form>`}
  <p class="nota">Con el recuento cerrado, los agentes no ven el formulario. Abrirlo bloquea la estructura de las candidaturas.${modo === 'DEMO' ? ' En DEMO se puede abrir sin requisitos y con lo que sea (es una práctica).' : ''}</p>
</section>
${sello}
${resumen.borradores > 0 ? html`<p class="nota">${resumen.borradores} mesas en borrador (no suman hasta que se cierren).</p>` : ''}
<h2>Resultados</h2>
${resultadosRecuento(resumen)}
<p class="nota">Votos de las mesas <strong>cerradas</strong>. % sobre votos válidos (candidaturas + blancos).</p>
<h2>Por mesa</h2>
${matrizRecuento(resumen)}
<div id="sondeo" data-intervalo="5000" hidden></div>
<script src="${recurso('/resumen.js')}" defer></script>`;
    return paginaAdmin('Recuento del Congreso', ctx, cuerpo.texto);
  }

  app.get('/admin/recuento', async (req, reply) => responder(reply, panel(req, ctxHoja(req))));

  app.post('/admin/recuento/abrir', async (req, reply) => {
    const modo = req.modo.modo;
    const r = comprobarApertura({ db, captura: req.captura, modo, ahora: req.modo.ahora });
    if (!r.ok) return responder(reply, panel(req, ctxHoja(req, { error: r.motivos.join(' ') })), 409);
    if (r.avisos.length > 0 && req.body?.confirmar !== '1') {
      const ctx = ctxHoja(req);
      const confirmacion = html`<div class="confirmar tarjeta" role="alert">
    <h2>Antes de abrir</h2>
    <ul>${r.avisos.map((a) => html`<li>${a}</li>`)}</ul>
    <form method="post" action="/admin/recuento/abrir" class="formulario">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="confirmar" value="1">
      <button type="submit" class="boton">Abrir de todos modos</button>
    </form>
    <p><a class="boton boton-sec" href="/admin/recuento">No, esperar</a></p>
  </div>`;
      return responder(reply, panel(req, ctx, { confirmacion }));
    }
    abrirRecuento(db, modo, req.admin);
    return reply.redirect('/admin/recuento?ok=recuento_abierto');
  });

  app.post('/admin/recuento/cerrar', async (req, reply) => {
    const modo = req.modo.modo;
    if (req.body?.confirmar !== '1') {
      const ctx = ctxHoja(req);
      const confirmacion = html`<div class="confirmar tarjeta" role="alert">
    <h2>¿Cerrar el recuento?</h2>
    <p>Los agentes dejarán de ver el formulario. Los borradores se conservan y puedes volver a abrirlo.</p>
    <form method="post" action="/admin/recuento/cerrar" class="formulario">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="confirmar" value="1">
      <button type="submit" class="boton">Sí, cerrar el recuento</button>
    </form>
    <p><a class="boton boton-sec" href="/admin/recuento">No, volver</a></p>
  </div>`;
      return responder(reply, panel(req, ctx, { confirmacion }));
    }
    cerrarRecuento(db, modo, req.admin);
    return reply.redirect('/admin/recuento?ok=recuento_cerrado');
  });

  // ---------- Ficha de mesa (el administrador puede siempre, también con el recuento cerrado) ----------
  const base = (mesaId) => `/admin/recuento/mesa/${mesaId}`;
  const noEncontrada = (req, reply) => responder(reply, paginaAdmin('Mesa no encontrada', req.ctx(), '<p><a href="/admin/recuento">Volver al recuento</a></p>'), 404);

  function pantallaMesa(req, mesaId, { entrada = null, error = null, confirmacion = null, version = null } = {}) {
    const datos = cargarMesaRecuento(db, req.captura, mesaId);
    if (!datos) return null;
    const ctx = ctxHoja(req, { error });
    const valores = entrada ? valoresDeEntrada(entrada) : valoresDeDatos(datos);
    const v = version ?? datos.cab?.version ?? 0;
    const cerrada = datos.cab?.estado === 'cerrado';
    const cuerpo = confirmacion
      ? bloqueConfirmarCierre({
          csrf: ctx.csrf, base: base(mesaId), datos, version: confirmacion.version,
          valores: { votantes: String(confirmacion.valores.votantes), blancos: String(confirmacion.valores.blancos), nulos: String(confirmacion.valores.nulos), votos: confirmacion.valores.votos },
          avisos: confirmacion.avisos, suma: confirmacion.suma, urlVolver: base(mesaId), rol: 'admin',
        })
      : html`${formularioRecuento({ csrf: ctx.csrf, base: base(mesaId), datos, valores, version: v, rol: 'admin' })}
${cerrada
  ? html`<form method="post" action="${base(mesaId)}/reabrir" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <input type="hidden" name="version" value="${datos.cab.version}">
  <button type="submit" class="boton boton-sec">Reabrir la mesa</button>
</form>`
  : ''}
<p><a href="/admin/recuento">Volver al recuento</a></p>`;
    return paginaAdmin(`Recuento · Mesa ${datos.mesa.codigo}`, ctx, cuerpo.texto);
  }

  app.get('/admin/recuento/mesa/:id', async (req, reply) => {
    const pagina = pantallaMesa(req, idDe(req.params.id));
    return pagina ? responder(reply, pagina) : noEncontrada(req, reply);
  });

  async function guardar(req, reply, { cerrar }) {
    const mesaId = idDe(req.params.id);
    const datos = cargarMesaRecuento(db, req.captura, mesaId);
    if (!datos) return esPeticionFetch(req) ? reply.code(404).send({ ok: false, estado: 'no_encontrado' }) : noEncontrada(req, reply);
    const entrada = entradaDeBody(req.body, datos.candidaturas);
    const version = versionDeBody(req.body);
    const r = version === null
      ? { estado: 'error', errores: ['Versión de la mesa no válida: recarga la página.'] }
      : guardarRecuentoMesa({
          db, captura: req.captura, actor: req.admin, mesaId, entrada, version, cerrar,
          confirmar: req.body?.confirmar === '1', automatico: req.body?.auto === '1', modo: req.modo.modo,
        });
    if (esPeticionFetch(req)) return reply.code(codigoHttp(r)).send(jsonDeResultado(r));
    switch (r.estado) {
      case 'guardado': return reply.redirect(`${base(mesaId)}?ok=recuento_guardado`);
      case 'cerrado': return reply.redirect(`/admin/recuento?ok=recuento_mesa_cerrada`);
      case 'confirmar': return responder(reply, pantallaMesa(req, mesaId, { confirmacion: r }));
      case 'conflicto': return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.mensaje, version: r.versionActual }), 409);
      case 'error': return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.errores.join(' ') }), 422);
      default: return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.mensaje }), codigoHttp(r));
    }
  }

  app.post('/admin/recuento/mesa/:id/guardar', (req, reply) => guardar(req, reply, { cerrar: false }));
  app.post('/admin/recuento/mesa/:id/cerrar', (req, reply) => guardar(req, reply, { cerrar: true }));

  app.post('/admin/recuento/mesa/:id/reabrir', async (req, reply) => {
    const mesaId = idDe(req.params.id);
    const version = versionDeBody(req.body);
    const r = version === null ? { estado: 'error' } : reabrirRecuentoMesa({ db, captura: req.captura, actor: req.admin, mesaId, version });
    if (r.estado === 'no_encontrado') return noEncontrada(req, reply);
    if (r.estado === 'conflicto') return responder(reply, pantallaMesa(req, mesaId, { error: r.mensaje }), 409);
    return reply.redirect(`${base(mesaId)}?ok=recuento_reabierta`);
  });
}
