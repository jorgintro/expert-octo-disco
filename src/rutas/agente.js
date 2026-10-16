import { auditar } from '../auditoria.js';
import { hojaCandidaturas } from '../candidaturas.js';
import { codigoHttp, entradaDeBody, esPeticionFetch, jsonDeResultado, valoresDeEntrada, versionDeBody } from '../entradaRecuento.js';
import { recuentoAbierto, senadoAbierto } from '../recuentoEstado.js';
import { codigoHttp as codigoHttpSenado, entradaDeBody as entradaSenadoDeBody, jsonDeResultado as jsonSenado, valoresDeDatos as valoresSenadoDeDatos } from '../entradaSenado.js';
import { cargarMesaSenado, comprobarAccesoSenado, guardarSenadoMesa } from '../servicioSenado.js';
import { bloqueConfirmarCierreSenado, elegirModo, formularioTotales, pantallaSabana, pestanas, vistaSoloLecturaSenado, ESTADOS_MESA as ESTADOS_SENADO } from '../vistasSenado.js';
import { cargarMesaRecuento, comprobarAcceso, guardarRecuentoMesa } from '../servicioRecuento.js';
import { ESTADOS_MESA, bloqueConfirmarCierre, formularioRecuento, valoresDeDatos, vistaSoloLectura } from '../vistasRecuento.js';
import { crearCsrfLogin, textoSeguro } from '../csrfLogin.js';
import { estaBloqueada, registrarFallo } from '../limiteIntentos.js';
import { construirHistorial, corteActual } from '../participacion.js';
import { hmacPin } from '../pin.js';
import { borrarSesionDeTipo, buscarSesion, crearSesion, DURACION_SESION_MS } from '../sesiones.js';
import { datosDeMesa, guardarDato, MENSAJE_BLOQUEADO } from '../servicioParticipacion.js';
import { horaMadrid } from '../tiempo.js';
import { aviso, html, pagina, paginaAgente, responder } from '../vistas.js';
import { autorDe, bloqueConfirmar, formularioDato, selectorCortes, tablaHistorial } from '../vistasDato.js';

const COOKIE = 'sid_agente'; // distinta de la del administrador: ambos pueden convivir en un navegador

function formPin({ csrf, error } = {}) {
  return pagina(
    'Participación y recuento',
    html`<h1>Participación y recuento</h1>
<p class="subtitulo">Colegio Dulcinea · Alcalá de Henares</p>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="/entrar" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${csrf}">
  <label for="pin">Tu PIN de 6 dígitos</label>
  <input id="pin" name="pin" class="campo-numero" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required autofocus>
  <button type="submit" class="boton">Entrar</button>
</form>
<p class="discreto"><a href="/admin/login">Acceso administrador</a></p>`.texto
  );
}

export default async function rutasAgente(app) {
  const { db, config } = app;
  const csrfPin = crearCsrfLogin({
    secreto: config.sessionSecret,
    cookie: 'csrf_pin',
    ruta: '/entrar',
    segura: config.cookieSegura,
  });
  const cookieSesion = (reply, token) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: config.cookieSegura,
      sameSite: 'lax',
      path: '/',
      maxAge: DURACION_SESION_MS / 1000,
    });
  const agenteDeSesion = (req) => {
    const sesion = buscarSesion(db, config.sessionSecret, req.cookies[COOKIE]);
    if (!sesion || sesion.actor_tipo !== 'agente') return null;
    const agente = db.prepare('SELECT id, nombre, activo, pin_hmac FROM agente WHERE id = ?').get(sesion.actor_id);
    return agente?.activo && agente.pin_hmac ? { sesion, agente } : null;
  };
  const pinHtml = (reply, opciones, codigo = 200) => {
    reply.header('Cache-Control', 'no-store');
    return responder(reply, formPin({ ...opciones, csrf: csrfPin.emitir(reply) }), codigo);
  };

  // ---- Entrada por PIN (pública) ----
  app.get('/', async (req, reply) => {
    if (agenteDeSesion(req)) return reply.redirect('/agente');
    return pinHtml(reply, {});
  });

  app.post('/entrar', async (req, reply) => {
    if (!csrfPin.valido(req)) return pinHtml(reply, { error: 'La página ha caducado. Vuelve a intentarlo.' }, 403);
    const ip = req.ip;
    if (estaBloqueada(db, 'pin', ip)) {
      return pinHtml(reply, { error: 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.' }, 429);
    }
    const pin = String(req.body?.pin ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(pin)) return pinHtml(reply, { error: 'El PIN tiene 6 dígitos.' }, 422); // no cuenta: no puede acertar

    const agente = db
      .prepare('SELECT id, nombre FROM agente WHERE pin_hmac = ? AND activo = 1')
      .get(hmacPin(config.pinHmacSecret, pin));
    if (!agente) {
      registrarFallo(db, 'pin', ip);
      return pinHtml(reply, { error: 'PIN incorrecto.' }, 401);
    }
    // Un acierto NO reinicia el contador de la IP: los agentes comparten IP y, si no, un atacante
    // en la misma red lo reiniciaría cada vez que un agente entrase. Caduca solo (ventana de 5 min).
    borrarSesionDeTipo(db, config.sessionSecret, req.cookies[COOKIE], 'agente');
    const { token } = crearSesion(db, config.sessionSecret, 'agente', agente.id);
    auditar(db, { tipo: 'agente', id: agente.id }, 'login', 'agente', agente.id);
    cookieSesion(reply, token);
    csrfPin.borrar(reply);
    return reply.redirect('/agente');
  });

  // ---- Protegidas (solo rol agente) ----
  await app.register(async (priv) => {
    priv.addHook('preHandler', async (req, reply) => {
      const actual = agenteDeSesion(req);
      if (!actual) {
        borrarSesionDeTipo(db, config.sessionSecret, req.cookies[COOKIE], 'agente');
        reply.clearCookie(COOKIE, { path: '/' });
        return reply.redirect('/');
      }
      if (req.method === 'POST' && !textoSeguro(req.body?._csrf ?? '', actual.sesion.csrf)) {
        return responder(reply, pagina('Petición no válida', '<h1>Petición no válida</h1><p>Recarga la página e inténtalo de nuevo.</p>'), 403);
      }
      req.sesion = actual.sesion;
      req.agente = actual.agente;
      req.actor = { tipo: 'agente', id: actual.agente.id };
      req.ctx = (extra = {}) => ({ csrf: actual.sesion.csrf, aviso: aviso(req.query?.ok), agente: actual.agente, ...extra });
      reply.header('Cache-Control', 'no-store');
    });

    const mesasDelAgente = (agenteId) =>
      db
        .prepare(
          `SELECT m.* FROM mesa m JOIN agente_mesa am ON am.mesa_id = m.id
           WHERE am.agente_id = ? AND m.activa = 1
           ORDER BY CAST(m.distrito AS INTEGER), CAST(m.seccion AS INTEGER), m.letra`
        )
        .all(agenteId);
    // Un agente solo toca sus mesas (y activas): cualquier otra se trata igual que si no existiera.
    const mesaDelAgente = (agenteId, id) =>
      /^\d+$/.test(String(id)) ? mesasDelAgente(agenteId).find((m) => m.id === Number(id)) : undefined;
    const denegada = (req, reply) =>
      responder(reply, paginaAgente('Mesa no disponible', req.ctx(), '<p>Esa mesa no es tuya o no existe.</p><p><a href="/agente">Volver</a></p>'), 403);

    priv.get('/agente', async (req, reply) => {
      const mesas = mesasDelAgente(req.agente.id);
      if (mesas.length === 1) return reply.redirect(`/agente/mesa/${mesas[0].id}`);
      const cuerpo =
        mesas.length === 0
          ? html`<section class="tarjeta"><p>No tienes ninguna mesa asignada. Avisa al Jefe de Colegio.</p></section>`
          : html`<p>Elige la mesa:</p>${mesas.map((m) => html`<p><a class="boton" href="/agente/mesa/${m.id}">Mesa ${m.codigo}</a></p>`)}`;
      return responder(reply, paginaAgente('Tus mesas', req.ctx(), cuerpo.texto));
    });

    // Con el recuento cerrado los agentes no ven nada del recuento; abierto, ven el estado de su mesa y el acceso.
    function tarjetaRecuento(req, mesa) {
      if (!recuentoAbierto(db, req.modo.modo)) return '';
      const { cab } = req.captura.obtenerRecuento(mesa.id);
      const estado = cab?.estado ?? 'sin_iniciar';
      return html`<section class="tarjeta">
  <h2>Recuento del Congreso</h2>
  <p class="estado-mesa ${estado}">${ESTADOS_MESA[estado]}</p>
  <p><a class="boton" href="/agente/mesa/${mesa.id}/recuento">${estado === 'cerrado' ? 'Ver el recuento' : 'Abrir el recuento'}</a></p>
</section>`;
    }

    function tarjetaSenado(req, mesa) {
      if (!senadoAbierto(db, req.modo.modo)) return '';
      const { cab } = req.captura.obtenerSenado(mesa.id);
      const estado = cab?.estado ?? 'sin_iniciar';
      return html`<section class="tarjeta">
  <h2>Recuento del Senado</h2>
  <p class="estado-mesa ${estado}">${ESTADOS_SENADO[estado]}</p>
  <p><a class="boton" href="/agente/mesa/${mesa.id}/senado">${estado === 'cerrado' ? 'Ver el recuento del Senado' : 'Abrir el recuento del Senado'}</a></p>
</section>`;
    }

    // Pestañas Congreso | Senado (solo si ambos están abiertos).
    const pestanasAgente = (req, mesa, activa) =>
      pestanas({
        congresoUrl: `/agente/mesa/${mesa.id}/recuento`, senadoUrl: `/agente/mesa/${mesa.id}/senado`, activa,
        congreso: recuentoAbierto(db, req.modo.modo), senado: senadoAbierto(db, req.modo.modo),
      });

    function pantallaMesa(req, mesa, { corteId = null, valor = null, error = null, confirmacion = null } = {}) {
      const datos = datosDeMesa(db, req.captura, mesa.id);
      const actual = corteActual(datos.cortes, horaMadrid(req.modo.ahora));
      const pedido = corteId ?? (/^\d+$/.test(req.query?.corte ?? '') ? Number(req.query.corte) : null);
      const corte = datos.cortes.find((c) => c.id === pedido) ?? actual;
      const fila = datos.filas.find((f) => f.corte_id === corte.id);
      const urlBase = `/agente/mesa/${mesa.id}`;
      const bloqueado = fila?.introducido_por_tipo === 'admin';
      const otras = mesasDelAgente(req.agente.id);

      let tarjeta;
      if (confirmacion) {
        tarjeta = bloqueConfirmar({
          csrf: req.sesion.csrf, accion: `${urlBase}/guardar`, corteId: corte.id, valor: confirmacion.valor,
          avisos: confirmacion.avisos, urlCorregir: `${urlBase}?corte=${corte.id}`,
        });
      } else if (bloqueado) {
        tarjeta = html`<p class="dato-grande">${fila.votantes_acumulados}</p><p class="aviso-bloqueo" role="alert">${MENSAJE_BLOQUEADO}</p>`;
      } else {
        tarjeta = formularioDato({
          csrf: req.sesion.csrf, accion: `${urlBase}/guardar`, corteId: corte.id,
          valor: valor ?? (fila ? String(fila.votantes_acumulados) : ''),
        });
      }
      const cuerpo = html`${otras.length > 1
        ? html`<nav class="pildoras" aria-label="Cambiar de mesa">${otras.map((m) => html`<a href="/agente/mesa/${m.id}" class="${m.id === mesa.id ? 'pildora activa' : 'pildora'}">${m.codigo}</a>`)}</nav>`
        : ''}
<section class="tarjeta">
  <h2>Corte de las ${corte.hora}${corte.id === actual.id ? ' (actual)' : ''}</h2>
  <p class="nota">Censo de la mesa: <strong>${mesa.censo}</strong> electores. Escribe el total acumulado de votantes hasta esta hora.</p>
  ${fila ? html`<p class="nota">Último dato: <strong>${fila.votantes_acumulados}</strong> · ${autorDe(db, fila)}</p>` : ''}
  ${tarjeta}
</section>
${tarjetaRecuento(req, mesa)}
${tarjetaSenado(req, mesa)}
${selectorCortes({ cortes: datos.cortes, filas: datos.filas, seleccionadoId: corte.id, actualId: actual.id, urlBase })}
<h2>Histórico de la mesa</h2>
${tablaHistorial({ filas: construirHistorial({ cortes: datos.cortes, filas: datos.filas, censo: mesa.censo }), urlBase })}`;
      return paginaAgente(`Mesa ${mesa.codigo}`, req.ctx({ error }), cuerpo.texto);
    }

    priv.get('/agente/mesa/:id', async (req, reply) => {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return denegada(req, reply);
      return responder(reply, pantallaMesa(req, mesa));
    });

    priv.post('/agente/mesa/:id/guardar', async (req, reply) => {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return denegada(req, reply);
      const corteId = /^\d+$/.test(String(req.body.corte ?? '')) ? Number(req.body.corte) : NaN;
      const texto = String(req.body.votantes ?? '');
      const r = guardarDato({
        db, captura: req.captura, actor: req.actor, mesaId: mesa.id, corteId, texto,
        confirmar: req.body.confirmar === '1', ahora: req.modo.ahora, modo: req.modo.modo,
      });
      switch (r.estado) {
        case 'no_encontrado':
          return denegada(req, reply);
        case 'bloqueado':
          return responder(reply, pantallaMesa(req, mesa, { corteId, error: r.mensaje }), 403);
        case 'error':
          return responder(reply, pantallaMesa(req, mesa, { corteId, valor: texto, error: r.errores.join(' ') }), 422);
        case 'confirmar':
          return responder(reply, pantallaMesa(req, mesa, { corteId, confirmacion: r }));
        default:
          return reply.redirect(`/agente/mesa/${mesa.id}?corte=${corteId}&ok=${r.estado === 'guardado' ? 'dato_guardado' : 'dato_sin_cambios'}`);
      }
    });

    // ---------- Recuento del Congreso (solo con el recuento abierto) ----------
    const baseRecuento = (mesa) => `/agente/mesa/${mesa.id}/recuento`;
    const ctxRecuento = (req, extra = {}) => req.ctx({ hojas: [hojaCandidaturas(db).url], ...extra });

    function pantallaRecuento(req, mesa, { entrada = null, error = null, confirmacion = null, version = null } = {}) {
      const datos = cargarMesaRecuento(db, req.captura, mesa.id);
      const ctx = ctxRecuento(req, { error });
      const acceso = comprobarAcceso({ db, actor: req.actor, cab: datos.cab, modo: req.modo.modo });
      if (acceso?.estado === 'recuento_cerrado') {
        return { codigo: 403, pagina: paginaAgente(`Recuento · Mesa ${mesa.codigo}`, ctx, html`<section class="tarjeta"><p class="aviso-bloqueo" role="alert">${acceso.mensaje} Cuando el Jefe de Colegio lo abra, aparecerá aquí.</p></section><p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`.texto) };
      }
      if (acceso) {
        const cuerpo = html`${pestanasAgente(req, mesa, 'congreso')}${vistaSoloLectura({ datos, mensaje: acceso.mensaje })}<p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`;
        return { codigo: 200, pagina: paginaAgente(`Recuento · Mesa ${mesa.codigo}`, ctx, cuerpo.texto) };
      }
      const cuerpo = confirmacion
        ? bloqueConfirmarCierre({
            csrf: req.sesion.csrf, base: baseRecuento(mesa), datos, version: confirmacion.version,
            valores: { votantes: String(confirmacion.valores.votantes), blancos: String(confirmacion.valores.blancos), nulos: String(confirmacion.valores.nulos), votos: confirmacion.valores.votos },
            avisos: confirmacion.avisos, suma: confirmacion.suma, urlVolver: baseRecuento(mesa), rol: 'agente',
          })
        : html`${pestanasAgente(req, mesa, 'congreso')}${formularioRecuento({
            csrf: req.sesion.csrf, base: baseRecuento(mesa), datos,
            valores: entrada ? valoresDeEntrada(entrada) : valoresDeDatos(datos), version: version ?? datos.cab?.version ?? 0, rol: 'agente',
          })}<p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`;
      return { codigo: 200, pagina: paginaAgente(`Recuento · Mesa ${mesa.codigo}`, ctx, cuerpo.texto) };
    }

    priv.get('/agente/mesa/:id/recuento', async (req, reply) => {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return denegada(req, reply);
      const { codigo, pagina } = pantallaRecuento(req, mesa);
      return responder(reply, pagina, codigo);
    });

    async function guardarRecuento(req, reply, { cerrar }) {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return esPeticionFetch(req) ? reply.code(403).send({ ok: false, estado: 'bloqueado', mensaje: 'Esa mesa no es tuya o no existe.' }) : denegada(req, reply);
      const datos = cargarMesaRecuento(db, req.captura, mesa.id);
      const entrada = entradaDeBody(req.body, datos.candidaturas);
      const version = versionDeBody(req.body);
      const r = version === null
        ? { estado: 'error', errores: ['Versión de la mesa no válida: recarga la página.'] }
        : guardarRecuentoMesa({
            db, captura: req.captura, actor: req.actor, mesaId: mesa.id, entrada, version, cerrar,
            confirmar: req.body?.confirmar === '1', automatico: req.body?.auto === '1', modo: req.modo.modo,
          });
      if (esPeticionFetch(req)) return reply.code(codigoHttp(r)).send(jsonDeResultado(r));
      switch (r.estado) {
        case 'guardado': return reply.redirect(`${baseRecuento(mesa)}?ok=recuento_guardado`);
        case 'cerrado': return reply.redirect(`/agente/mesa/${mesa.id}?ok=recuento_mesa_cerrada`);
        case 'confirmar': {
          const p = pantallaRecuento(req, mesa, { confirmacion: r });
          return responder(reply, p.pagina, p.codigo);
        }
        case 'conflicto': {
          const p = pantallaRecuento(req, mesa, { entrada, error: r.mensaje, version: r.versionActual });
          return responder(reply, p.pagina, 409);
        }
        case 'error': {
          const p = pantallaRecuento(req, mesa, { entrada, error: r.errores.join(' ') });
          return responder(reply, p.pagina, 422);
        }
        default: {
          const p = pantallaRecuento(req, mesa);
          return responder(reply, p.pagina, codigoHttp(r) === 404 ? 404 : p.codigo === 200 ? codigoHttp(r) : p.codigo);
        }
      }
    }

    priv.post('/agente/mesa/:id/recuento/guardar', (req, reply) => guardarRecuento(req, reply, { cerrar: false }));
    priv.post('/agente/mesa/:id/recuento/cerrar', (req, reply) => guardarRecuento(req, reply, { cerrar: true }));

    // ---------- Recuento del Senado (solo con el Senado abierto) ----------
    const baseSenado = (mesa) => `/agente/mesa/${mesa.id}/senado`;

    function pantallaSenado(req, mesa, { entrada = null, error = null, confirmacion = null, version = null } = {}) {
      const datos = cargarMesaSenado(db, req.captura, mesa.id);
      const ctx = ctxRecuento(req, { error });
      const titulo = `Senado · Mesa ${mesa.codigo}`;
      const acceso = comprobarAccesoSenado({ db, actor: req.actor, cab: datos.cab, modo: req.modo.modo });
      if (acceso?.estado === 'senado_cerrado') {
        return { codigo: 403, pagina: paginaAgente(titulo, ctx, html`<section class="tarjeta"><p class="aviso-bloqueo" role="alert">${acceso.mensaje} Cuando el Jefe de Colegio lo abra, aparecerá aquí.</p></section><p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`.texto) };
      }
      const tabs = pestanasAgente(req, mesa, 'senado');
      if (acceso) {
        const cuerpo = html`${tabs}${vistaSoloLecturaSenado({ datos, mensaje: acceso.mensaje })}<p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`;
        return { codigo: 200, pagina: paginaAgente(titulo, ctx, cuerpo.texto) };
      }
      const pedido = ['sabana', 'totales'].includes(req.query?.modo) ? req.query.modo : null;
      const modoMesa = datos.cab?.modo ?? entrada?.modo ?? pedido ?? 'sabana'; // el agente cuenta en sábana por defecto
      const valores = entrada ?? valoresSenadoDeDatos(datos);
      const v = version ?? datos.cab?.version ?? 0;
      const args = { csrf: req.sesion.csrf, base: baseSenado(mesa), datos, valores, version: v, rol: 'agente' };
      const cuerpo = confirmacion
        ? bloqueConfirmarCierreSenado({
            csrf: req.sesion.csrf, base: baseSenado(mesa), datos, version: confirmacion.version, valores: confirmacion.valores,
            avisos: confirmacion.avisos, suma: confirmacion.suma, contadas: confirmacion.contadas, urlVolver: baseSenado(mesa), rol: 'agente',
          })
        : html`${tabs}${datos.cab ? '' : elegirModo({ base: baseSenado(mesa), predeterminado: 'sabana' })}${modoMesa === 'sabana' ? pantallaSabana(args) : formularioTotales(args)}<p><a href="/agente/mesa/${mesa.id}">Volver a la mesa</a></p>`;
      return { codigo: 200, pagina: paginaAgente(titulo, ctx, cuerpo.texto) };
    }

    priv.get('/agente/mesa/:id/senado', async (req, reply) => {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return denegada(req, reply);
      const { codigo, pagina } = pantallaSenado(req, mesa);
      return responder(reply, pagina, codigo);
    });

    async function guardarSenado(req, reply, { cerrar }) {
      const mesa = mesaDelAgente(req.agente.id, req.params.id);
      if (!mesa) return esPeticionFetch(req) ? reply.code(403).send({ ok: false, estado: 'bloqueado', mensaje: 'Esa mesa no es tuya o no existe.' }) : denegada(req, reply);
      const datos = cargarMesaSenado(db, req.captura, mesa.id);
      const entrada = entradaSenadoDeBody(req.body, datos.candidatos);
      const version = versionDeBody(req.body);
      const r = version === null
        ? { estado: 'error', errores: ['Versión de la mesa no válida: recarga la página.'] }
        : guardarSenadoMesa({
            db, captura: req.captura, actor: req.actor, mesaId: mesa.id, entrada, version, cerrar,
            confirmar: req.body?.confirmar === '1', automatico: req.body?.auto === '1', modo: req.modo.modo,
          });
      if (esPeticionFetch(req)) return reply.code(codigoHttpSenado(r)).send(jsonSenado(r));
      switch (r.estado) {
        case 'guardado':
        case 'sin_datos': return reply.redirect(`${baseSenado(mesa)}?ok=senado_guardado`);
        case 'cerrado': return reply.redirect(`/agente/mesa/${mesa.id}?ok=senado_mesa_cerrada`);
        case 'confirmar': {
          const p = pantallaSenado(req, mesa, { confirmacion: r });
          return responder(reply, p.pagina, p.codigo);
        }
        case 'conflicto': {
          const p = pantallaSenado(req, mesa, { entrada, error: r.mensaje, version: r.versionActual });
          return responder(reply, p.pagina, 409);
        }
        case 'error': {
          const p = pantallaSenado(req, mesa, { entrada, error: r.errores.join(' ') });
          return responder(reply, p.pagina, 422);
        }
        default: {
          const p = pantallaSenado(req, mesa, { error: r.mensaje });
          return responder(reply, p.pagina, codigoHttpSenado(r) === 404 ? 404 : p.codigo === 200 ? codigoHttpSenado(r) : p.codigo);
        }
      }
    }

    priv.post('/agente/mesa/:id/senado/guardar', (req, reply) => guardarSenado(req, reply, { cerrar: false }));
    priv.post('/agente/mesa/:id/senado/cerrar', (req, reply) => guardarSenado(req, reply, { cerrar: true }));

    priv.post('/agente/salir', async (req, reply) => {
      borrarSesionDeTipo(db, config.sessionSecret, req.cookies[COOKIE], 'agente');
      reply.clearCookie(COOKIE, { path: '/' });
      return reply.redirect('/');
    });
  });
}
