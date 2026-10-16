import argon2 from 'argon2';
import { MAX_PASSWORD, verificarPasswordAdmin } from '../auth.js';
import { crearCsrfLogin, textoSeguro } from '../csrfLogin.js';
import { auditar } from '../auditoria.js';
import { estaBloqueada, limpiarFallos, registrarFallo } from '../limiteIntentos.js';
import { borrarSesion, borrarSesionesDeActor, buscarSesion, crearSesion, DURACION_SESION_MS } from '../sesiones.js';
import { aviso, html, pagina, paginaAdmin, responder } from '../vistas.js';
import rutasAgentes from './agentes.js';
import rutasBloqueos from './bloqueos.js';
import rutasCandidaturas from './candidaturas.js';
import rutasMesas from './mesas.js';
import rutasParticipacion from './participacion.js';
import rutasModo from './modo.js';
import rutasRecuento from './recuento.js';
import rutasSenado from './senado.js';
import rutasSenadoCandidatos from './senadoCandidatos.js';
import rutasResumen from './resumen.js';
import rutasHistorico from './historico.js';
import rutasCortes from './cortes.js';

const MIN_PASSWORD = 10;
let hashFicticio = null; // para igualar tiempos cuando el usuario no existe

function formLogin({ csrf, error, usuario = '' } = {}) {
  return pagina(
    'Acceso administrador',
    html`<h1>Acceso administrador</h1>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="/admin/login" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${csrf}">
  <label for="usuario">Usuario</label>
  <input id="usuario" name="usuario" type="text" autocomplete="username" autocapitalize="none" required value="${usuario}">
  <label for="contrasena">Contraseña</label>
  <input id="contrasena" name="contrasena" type="password" autocomplete="current-password" required>
  <button type="submit" class="boton">Entrar</button>
</form>
<p><a href="/">Volver al inicio</a></p>`.texto
  );
}

export default async function rutasAdmin(app) {
  const { db, config } = app;
  const cookieSesion = (reply, token) =>
    reply.setCookie('sid', token, {
      httpOnly: true,
      secure: config.cookieSegura,
      sameSite: 'lax',
      path: '/',
      maxAge: DURACION_SESION_MS / 1000,
    });

  const csrfLogin = crearCsrfLogin({
    secreto: config.sessionSecret,
    cookie: 'csrf_login',
    ruta: '/admin/login',
    segura: config.cookieSegura,
  });
  const loginHtml = (reply, opciones, codigo = 200) => {
    reply.header('Cache-Control', 'no-store');
    return responder(reply, formLogin({ ...opciones, csrf: csrfLogin.emitir(reply) }), codigo);
  };

  // ---- Públicas ----
  app.get('/admin/login', async (req, reply) => loginHtml(reply, {}));

  app.post('/admin/login', async (req, reply) => {
    if (!csrfLogin.valido(req)) {
      return loginHtml(reply, { error: 'La página ha caducado. Vuelve a intentarlo.' }, 403);
    }
    const ip = req.ip;
    if (estaBloqueada(db, 'admin', ip)) {
      return loginHtml(reply, { error: 'Demasiados intentos fallidos. Espera unos minutos antes de volver a probar.' }, 429);
    }
    const usuario = String(req.body?.usuario ?? '').trim().slice(0, 100);
    const contrasena = String(req.body?.contrasena ?? '');
    const admin = db.prepare('SELECT id, usuario, password_hash FROM admin WHERE usuario = ?').get(usuario);

    let correcto = false;
    if (contrasena.length > 0 && contrasena.length <= MAX_PASSWORD) {
      if (admin) {
        correcto = await argon2.verify(admin.password_hash, contrasena).catch(() => false);
      } else {
        hashFicticio ??= await argon2.hash('contraseña-ficticia');
        await argon2.verify(hashFicticio, contrasena).catch(() => false);
      }
    }

    if (!correcto) {
      registrarFallo(db, 'admin', ip);
      return loginHtml(reply, { error: 'Usuario o contraseña incorrectos.', usuario }, 401);
    }

    limpiarFallos(db, 'admin', ip);
    borrarSesion(db, config.sessionSecret, req.cookies.sid);
    const { token } = crearSesion(db, config.sessionSecret, 'admin', admin.id);
    auditar(db, { tipo: 'admin', id: admin.id }, 'login', 'admin', admin.id);
    cookieSesion(reply, token);
    csrfLogin.borrar(reply);
    return reply.redirect('/admin');
  });

  // ---- Protegidas (solo rol administrador) ----
  await app.register(async (priv) => {
    priv.addHook('preHandler', async (req, reply) => {
      const sesion = buscarSesion(db, config.sessionSecret, req.cookies.sid);
      if (!sesion) return reply.redirect('/admin/login');
      if (sesion.actor_tipo !== 'admin') {
        return responder(reply, pagina('Acceso denegado', '<h1>Acceso denegado</h1><p>Esta zona es solo para administración.</p>'), 403);
      }
      if (['POST', 'PUT', 'DELETE'].includes(req.method) && !textoSeguro(req.body?._csrf ?? req.headers['x-csrf-token'] ?? '', sesion.csrf)) {
        return responder(
          reply,
          pagina('Petición no válida', '<h1>Petición no válida</h1><p>Recarga la página e inténtalo de nuevo.</p>'),
          403
        );
      }
      req.sesion = sesion;
      req.admin = { tipo: 'admin', id: sesion.actor_id };
      req.ctx = (extra = {}) => ({ csrf: sesion.csrf, aviso: aviso(req.query?.ok), ...extra });
      reply.header('Cache-Control', 'no-store');
    });

    priv.get('/admin', async (req, reply) => {
      const mesas = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(censo), 0) censo FROM mesa WHERE activa = 1').get();
      const agentes = db.prepare('SELECT COUNT(*) n FROM agente WHERE activo = 1').get();
      return responder(
        reply,
        paginaAdmin(
          'Panel de administración',
          req.ctx(),
          html`<section class="tarjeta">
  <p><strong>${mesas.n}</strong> mesas activas · censo total <strong>${mesas.censo}</strong></p>
  <p><strong>${agentes.n}</strong> agentes activos</p>
</section>
<p><a class="boton" href="/admin/mesas">Mesas y censo</a></p>
<p><a class="boton" href="/admin/agentes">Agentes y PIN</a></p>
<p><a class="boton" href="/admin/resumen">Resumen de participación</a></p>
<p><a class="boton" href="/pantallazo">Pantallazo (para WhatsApp)</a></p>
<p><a class="boton boton-sec" href="/admin/participacion">Participación: introducir o corregir datos</a></p>
<p><a class="boton boton-sec" href="/admin/historico">Histórico de cambios</a></p>
<p><a class="boton boton-sec" href="/admin/cortes">Horas de los cortes</a></p>
<p><a class="boton boton-sec" href="/admin/modo">Modo de trabajo (DEMO / REAL)</a></p>`.texto
        )
      );
    });

    priv.post('/admin/logout', async (req, reply) => {
      borrarSesion(db, config.sessionSecret, req.cookies.sid);
      reply.clearCookie('sid', { path: '/' });
      return reply.redirect('/admin/login');
    });

    const formPassword = (ctx) => html`<form method="post" action="/admin/password" class="tarjeta formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label for="actual">Contraseña actual</label>
  <input id="actual" name="actual" type="password" autocomplete="current-password" required>
  <label for="nueva">Contraseña nueva (mínimo ${MIN_PASSWORD} caracteres)</label>
  <input id="nueva" name="nueva" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD}">
  <label for="repetir">Repite la contraseña nueva</label>
  <input id="repetir" name="repetir" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD}">
  <button type="submit" class="boton">Cambiar contraseña</button>
</form>`;

    priv.get('/admin/password', async (req, reply) => {
      const ctx = req.ctx();
      return responder(reply, paginaAdmin('Cambiar contraseña', ctx, formPassword(ctx).texto));
    });

    priv.post('/admin/password', async (req, reply) => {
      const actual = String(req.body.actual ?? '');
      const nueva = String(req.body.nueva ?? '');
      const repetir = String(req.body.repetir ?? '');
      const fallo = (error, codigo = 422) => {
        const ctx = req.ctx({ error });
        return responder(reply, paginaAdmin('Cambiar contraseña', ctx, formPassword(ctx).texto), codigo);
      };
      if (estaBloqueada(db, 'admin', req.ip)) {
        return fallo('Demasiados intentos fallidos. Espera unos minutos o pide que desbloqueen tu IP.', 429);
      }
      if (!(await verificarPasswordAdmin(db, req.admin.id, actual))) {
        registrarFallo(db, 'admin', req.ip);
        return fallo('La contraseña actual no es correcta.');
      }
      if (nueva.length < MIN_PASSWORD) return fallo(`La contraseña nueva debe tener al menos ${MIN_PASSWORD} caracteres.`);
      if (nueva.length > MAX_PASSWORD) return fallo(`La contraseña nueva no puede superar los ${MAX_PASSWORD} caracteres.`);
      if (nueva !== repetir) return fallo('Las contraseñas nuevas no coinciden.');

      const hash = await argon2.hash(nueva);
      db.transaction(() => {
        db.prepare('UPDATE admin SET password_hash = ? WHERE id = ?').run(hash, req.admin.id);
        borrarSesionesDeActor(db, 'admin', req.admin.id, req.sesion.id);
        auditar(db, req.admin, 'cambiar_password', 'admin', req.admin.id);
      })();
      return reply.redirect('/admin/password?ok=password');
    });

    await priv.register(rutasMesas);
    await priv.register(rutasAgentes);
    await priv.register(rutasResumen);
    await priv.register(rutasHistorico);
    await priv.register(rutasCortes);
    await priv.register(rutasParticipacion);
    await priv.register(rutasCandidaturas);
    await priv.register(rutasRecuento);
    await priv.register(rutasSenado);
    await priv.register(rutasSenadoCandidatos);
    await priv.register(rutasModo);
    await priv.register(rutasBloqueos);
  });
}
