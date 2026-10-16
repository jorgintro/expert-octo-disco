import { hojaCandidaturas } from '../candidaturas.js';
import { listarCandidatos } from '../candidatosSenado.js';
import { codigoHttp, entradaDeBody, jsonDeResultado, valoresDeDatos } from '../entradaSenado.js';
import { esPeticionFetch, versionDeBody } from '../entradaRecuento.js';
import { senadoAbierto } from '../recuentoEstado.js';
import { construirResumenSenado } from '../senado.js';
import {
  abrirSenado, cargarMesaSenado, cerrarSenado, comprobarAperturaSenado, guardarSenadoMesa, pasarSenadoATotales, reabrirSenadoMesa, reiniciarSenadoMesa,
} from '../servicioSenado.js';
import { formatearMadrid } from '../tiempo.js';
import { html, paginaAdmin, recurso, responder } from '../vistas.js';
import {
  bloqueConfirmarCierreSenado, elegirModo, formularioTotales, matrizSenado, pantallaSabana, pestanas, resultadosSenado, vistaSoloLecturaSenado,
} from '../vistasSenado.js';

// Panel del recuento del Senado (administrador): apertura, resultados, matriz por mesa y ficha de cada mesa.
export default async function rutasSenado(app) {
  const { db } = app;
  const idDe = (v) => (/^\d+$/.test(String(v)) ? Number(v) : NaN);
  const ctxHoja = (req, extra = {}) => req.ctx({ hojas: [hojaCandidaturas(db).url], ...extra });
  const tabs = () => pestanas({ congresoUrl: '/admin/recuento', senadoUrl: '/admin/senado', activa: 'senado' });

  const cargarResumen = (req) => {
    const mesas = db.prepare('SELECT id, codigo, censo FROM mesa WHERE activa = 1 ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra').all();
    return construirResumenSenado({ mesas, candidatos: listarCandidatos(db), registros: req.captura.listarSenado() });
  };

  // ---------- Panel ----------
  function panel(req, ctx, { confirmacion = null } = {}) {
    const modo = req.modo.modo;
    const abierto = senadoAbierto(db, modo);
    const resumen = cargarResumen(req);
    const apertura = comprobarAperturaSenado({ db, modo, ahora: req.modo.ahora });
    const [fecha, hora] = formatearMadrid(req.modo.ahora).split(' ');
    const sello = resumen.provisional
      ? html`<p class="sello provisional">PROVISIONAL · ${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas</p>`
      : html`<p class="sello completo">COMPLETO · ${resumen.cerradas}/${resumen.totalMesas} mesas escrutadas</p>`;
    const cuerpo = html`${tabs()}
<section class="tarjeta">
  <p class="estado-recuento ${abierto ? 'abierto' : 'cerrado'}">Recuento del Senado ${modo === 'DEMO' ? '(demo) ' : ''}<strong>${abierto ? 'ABIERTO' : 'CERRADO'}</strong></p>
  <p class="nota">Actualizado: <time id="hora-actualizacion">${hora}</time> · ${fecha} · hora de Madrid</p>
  <p class="aviso-sin-conexion" role="alert">SIN CONEXIÓN · los datos son de las ${hora}</p>
  ${confirmacion ?? ''}
  ${abierto
    ? html`<form method="post" action="/admin/senado/cerrar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton boton-sec">Cerrar el recuento del Senado</button>
  </form>`
    : html`${apertura.motivos.length > 0
      ? html`<div class="error" role="alert"><p>No se puede abrir todavía:</p><ul>${apertura.motivos.map((m) => html`<li>${m}</li>`)}</ul></div>`
      : ''}
  <form method="post" action="/admin/senado/abrir" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <button type="submit" class="boton"${apertura.ok ? '' : ' disabled'}>Abrir el recuento del Senado</button>
  </form>`}
  <p class="nota">Independiente del Congreso. Con el recuento cerrado, los agentes no ven el formulario del Senado. Abrirlo bloquea la estructura de los candidatos.</p>
  <p><a class="boton boton-sec" href="/admin/senado/candidatos">Candidatos del Senado</a></p>
</section>
${sello}
${resumen.borradores > 0 ? html`<p class="nota">${resumen.borradores} mesas en borrador (no suman hasta que se cierren).</p>` : ''}
<h2>Resultados</h2>
${resultadosSenado(resumen)}
<p class="nota">Votos de las mesas <strong>cerradas</strong>.</p>
<h2>Por mesa</h2>
${matrizSenado(resumen)}
<div id="sondeo" data-intervalo="5000" hidden></div>
<script src="${recurso('/resumen.js')}" defer></script>`;
    return paginaAdmin('Recuento del Senado', ctx, cuerpo.texto);
  }

  app.get('/admin/senado', async (req, reply) => responder(reply, panel(req, ctxHoja(req))));

  app.post('/admin/senado/abrir', async (req, reply) => {
    const modo = req.modo.modo;
    const r = comprobarAperturaSenado({ db, modo, ahora: req.modo.ahora });
    if (!r.ok) return responder(reply, panel(req, ctxHoja(req, { error: r.motivos.join(' ') })), 409);
    if (r.avisos.length > 0 && req.body?.confirmar !== '1') {
      const ctx = ctxHoja(req);
      const confirmacion = html`<div class="confirmar tarjeta" role="alert">
    <h2>Antes de abrir</h2>
    <ul>${r.avisos.map((a) => html`<li>${a}</li>`)}</ul>
    <form method="post" action="/admin/senado/abrir" class="formulario">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="confirmar" value="1">
      <button type="submit" class="boton">Abrir de todos modos</button>
    </form>
    <p><a class="boton boton-sec" href="/admin/senado">No, esperar</a></p>
  </div>`;
      return responder(reply, panel(req, ctx, { confirmacion }));
    }
    abrirSenado(db, modo, req.admin);
    return reply.redirect('/admin/senado?ok=senado_abierto');
  });

  app.post('/admin/senado/cerrar', async (req, reply) => {
    const modo = req.modo.modo;
    if (req.body?.confirmar !== '1') {
      const ctx = ctxHoja(req);
      const confirmacion = html`<div class="confirmar tarjeta" role="alert">
    <h2>¿Cerrar el recuento del Senado?</h2>
    <p>Los agentes dejarán de ver el formulario del Senado. Los borradores se conservan y puedes volver a abrirlo.</p>
    <form method="post" action="/admin/senado/cerrar" class="formulario">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="confirmar" value="1">
      <button type="submit" class="boton">Sí, cerrar el recuento del Senado</button>
    </form>
    <p><a class="boton boton-sec" href="/admin/senado">No, volver</a></p>
  </div>`;
      return responder(reply, panel(req, ctx, { confirmacion }));
    }
    cerrarSenado(db, modo, req.admin);
    return reply.redirect('/admin/senado?ok=senado_cerrado');
  });

  // ---------- Ficha de mesa (el administrador puede siempre, también con el Senado cerrado) ----------
  const base = (mesaId) => `/admin/senado/mesa/${mesaId}`;
  const noEncontrada = (req, reply) => responder(reply, paginaAdmin('Mesa no encontrada', req.ctx(), '<p><a href="/admin/senado">Volver al recuento del Senado</a></p>'), 404);

  function pantallaMesa(req, mesaId, { entrada = null, error = null, confirmacion = null, reiniciar = false, pasar = false, version = null } = {}) {
    const datos = cargarMesaSenado(db, req.captura, mesaId);
    if (!datos) return null;
    const ctx = ctxHoja(req, { error });
    const cab = datos.cab;
    const pedido = ['sabana', 'totales'].includes(req.query?.modo) ? req.query.modo : null;
    const modoMesa = cab?.modo ?? entrada?.modo ?? pedido ?? 'totales'; // el administrador usa «totales» por defecto
    const valores = entrada ?? valoresDeDatos(datos);
    const v = version ?? cab?.version ?? 0;
    const cerrada = cab?.estado === 'cerrado';
    const volver = html`<p><a href="/admin/senado">Volver al recuento del Senado</a></p>`;
    const pie = cab
      ? html`${cerrada ? html`<form method="post" action="${base(mesaId)}/reabrir" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <input type="hidden" name="version" value="${cab.version}">
  <button type="submit" class="boton boton-sec">Reabrir la mesa</button>
</form>` : ''}
${cab.modo === 'sabana' ? html`<form method="post" action="${base(mesaId)}/pasar-a-totales" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <input type="hidden" name="version" value="${cab.version}">
  <button type="submit" class="boton boton-sec">Pasar a modo totales conservando cifras…</button>
</form>
<p class="nota">Copia los contadores actuales al modo totales, que pasa a ser editable. La mesa deja de contar en la estadística de bloque.</p>` : html`<p class="nota">Modo totales: datos de bloque no disponibles.</p>`}
<form method="post" action="${base(mesaId)}/reiniciar" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <input type="hidden" name="version" value="${cab.version}">
  <button type="submit" class="boton boton-sec">Reiniciar el Senado de esta mesa…</button>
</form>
<p class="nota">Reiniciar borra los contadores del Senado de la mesa y permite cambiar de modo. Queda en la auditoría.</p>`
      : '';

    let cuerpo;
    if (reiniciar) {
      cuerpo = html`<section class="tarjeta confirmar" role="alert">
  <h2>¿Reiniciar el Senado de la mesa ${datos.mesa.codigo}?</h2>
  <p>Se borran todos los contadores del Senado de esta mesa (modo ${cab?.modo === 'sabana' ? 'sábana a sábana' : 'totales'}). Después podrás empezar de nuevo en cualquiera de los dos modos. No se puede deshacer.</p>
  <form method="post" action="${base(mesaId)}/reiniciar" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <input type="hidden" name="version" value="${cab?.version ?? 0}">
    <input type="hidden" name="confirmar" value="1">
    <button type="submit" class="boton">Sí, reiniciar</button>
  </form>
  <p><a class="boton boton-sec" href="${base(mesaId)}">No, volver</a></p>
</section>`;
    } else if (pasar) {
      cuerpo = html`<section class="tarjeta confirmar" role="alert">
  <h2>¿Pasar la mesa ${datos.mesa.codigo} a modo totales?</h2>
  <p>Se conservan las cifras: votos por candidato (${[...datos.votos.values()].reduce((a, x) => a + x, 0)} en total), papeletas válidas (${cab?.validas ?? 0}), en blanco (${cab?.blancas ?? 0}) y nulas (${cab?.nulas ?? 0}). Se descarta el desglose por número de marcas: la mesa quedará con «datos de bloque no disponibles» y dejará de contar en la estadística de bloque. A partir de ahí se edita en totales. Queda en la auditoría con los valores anteriores y nuevos.</p>
  <form method="post" action="${base(mesaId)}/pasar-a-totales" class="formulario">
    <input type="hidden" name="_csrf" value="${ctx.csrf}">
    <input type="hidden" name="version" value="${cab?.version ?? 0}">
    <input type="hidden" name="confirmar" value="1">
    ${cab?.estado === 'cerrado'
      ? html`<fieldset class="opciones"><legend>La mesa está cerrada; después…</legend>
      <label class="casilla"><input type="radio" name="estado_final" value="borrador" checked> Dejarla reabierta (en borrador), para corregir</label>
      <label class="casilla"><input type="radio" name="estado_final" value="cerrado"> Dejarla cerrada</label></fieldset>`
      : ''}
    <button type="submit" class="boton">Sí, pasar a totales</button>
  </form>
  <p><a class="boton boton-sec" href="${base(mesaId)}">No, volver</a></p>
</section>`;
    } else if (confirmacion) {
      cuerpo = bloqueConfirmarCierreSenado({
        csrf: ctx.csrf, base: base(mesaId), datos, version: confirmacion.version, valores: confirmacion.valores,
        avisos: confirmacion.avisos, suma: confirmacion.suma, contadas: confirmacion.contadas, urlVolver: base(mesaId), rol: 'admin',
      });
    } else if (modoMesa === 'sabana' && cerrada) {
      cuerpo = html`${vistaSoloLecturaSenado({ datos, mensaje: 'Mesa cerrada: reábrela para seguir contando.' })}${pie}${volver}`;
    } else if (modoMesa === 'sabana') {
      cuerpo = html`${cab ? '' : elegirModo({ base: base(mesaId), predeterminado: 'sabana' })}${pantallaSabana({ csrf: ctx.csrf, base: base(mesaId), datos, valores, version: v, rol: 'admin' })}${pie}${volver}`;
    } else {
      cuerpo = html`${cab ? '' : elegirModo({ base: base(mesaId), predeterminado: 'totales' })}${formularioTotales({ csrf: ctx.csrf, base: base(mesaId), datos, valores, version: v, rol: 'admin' })}${pie}${volver}`;
    }
    return paginaAdmin(`Senado · Mesa ${datos.mesa.codigo}`, ctx, html`${cuerpo}`.texto);
  }

  app.get('/admin/senado/mesa/:id', async (req, reply) => {
    const pagina = pantallaMesa(req, idDe(req.params.id));
    return pagina ? responder(reply, pagina) : noEncontrada(req, reply);
  });

  async function guardar(req, reply, { cerrar }) {
    const mesaId = idDe(req.params.id);
    const datos = cargarMesaSenado(db, req.captura, mesaId);
    if (!datos) return esPeticionFetch(req) ? reply.code(404).send({ ok: false, estado: 'no_encontrado' }) : noEncontrada(req, reply);
    const entrada = entradaDeBody(req.body, datos.candidatos);
    const version = versionDeBody(req.body);
    const r = version === null
      ? { estado: 'error', errores: ['Versión de la mesa no válida: recarga la página.'] }
      : guardarSenadoMesa({
          db, captura: req.captura, actor: req.admin, mesaId, entrada, version, cerrar,
          confirmar: req.body?.confirmar === '1', automatico: req.body?.auto === '1', modo: req.modo.modo,
        });
    if (esPeticionFetch(req)) return reply.code(codigoHttp(r)).send(jsonDeResultado(r));
    switch (r.estado) {
      case 'guardado':
      case 'sin_datos': return reply.redirect(`${base(mesaId)}?ok=senado_guardado`);
      case 'cerrado': return reply.redirect('/admin/senado?ok=senado_mesa_cerrada');
      case 'confirmar': return responder(reply, pantallaMesa(req, mesaId, { confirmacion: r }));
      case 'conflicto': return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.mensaje, version: r.versionActual }), 409);
      case 'error': return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.errores.join(' ') }), 422);
      default: return responder(reply, pantallaMesa(req, mesaId, { entrada, error: r.mensaje }), codigoHttp(r));
    }
  }

  app.post('/admin/senado/mesa/:id/guardar', (req, reply) => guardar(req, reply, { cerrar: false }));
  app.post('/admin/senado/mesa/:id/cerrar', (req, reply) => guardar(req, reply, { cerrar: true }));

  app.post('/admin/senado/mesa/:id/reabrir', async (req, reply) => {
    const mesaId = idDe(req.params.id);
    const version = versionDeBody(req.body);
    const r = version === null ? { estado: 'error' } : reabrirSenadoMesa({ db, captura: req.captura, actor: req.admin, mesaId, version });
    if (r.estado === 'no_encontrado') return noEncontrada(req, reply);
    if (r.estado === 'conflicto') return responder(reply, pantallaMesa(req, mesaId, { error: r.mensaje }), 409);
    return reply.redirect(`${base(mesaId)}?ok=senado_reabierta`);
  });

  app.post('/admin/senado/mesa/:id/pasar-a-totales', async (req, reply) => {
    const mesaId = idDe(req.params.id);
    const datos = cargarMesaSenado(db, req.captura, mesaId);
    if (!datos) return noEncontrada(req, reply);
    if (datos.cab?.modo !== 'sabana') return responder(reply, pantallaMesa(req, mesaId, { error: 'Esta mesa no está en modo sábana.' }), 409);
    if (req.body?.confirmar !== '1') return responder(reply, pantallaMesa(req, mesaId, { pasar: true }));
    const version = versionDeBody(req.body);
    const r = version === null
      ? { estado: 'error' }
      : pasarSenadoATotales({ db, captura: req.captura, actor: req.admin, mesaId, version, estadoFinal: req.body?.estado_final === 'cerrado' ? 'cerrado' : 'borrador' });
    if (r.estado === 'conflicto') return responder(reply, pantallaMesa(req, mesaId, { error: r.mensaje }), 409);
    return reply.redirect(`${base(mesaId)}?ok=senado_pasada_totales`);
  });

  app.post('/admin/senado/mesa/:id/reiniciar', async (req, reply) => {
    const mesaId = idDe(req.params.id);
    if (!cargarMesaSenado(db, req.captura, mesaId)) return noEncontrada(req, reply);
    if (req.body?.confirmar !== '1') return responder(reply, pantallaMesa(req, mesaId, { reiniciar: true }));
    const version = versionDeBody(req.body);
    const r = version === null ? { estado: 'error' } : reiniciarSenadoMesa({ db, captura: req.captura, actor: req.admin, mesaId, version });
    if (r.estado === 'conflicto') return responder(reply, pantallaMesa(req, mesaId, { error: r.mensaje }), 409);
    return reply.redirect(`${base(mesaId)}?ok=senado_reiniciada`);
  });
}
