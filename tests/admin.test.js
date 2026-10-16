import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSesion } from '../src/sesiones.js';
import { hmacPin } from '../src/pin.js';
import { LIMITES } from '../src/limiteIntentos.js';
const MAX_FALLOS = LIMITES.admin.max;
import { CONFIG, cookieDe, crearEntorno, get, intentarLogin, loginAdmin, post } from './ayuda.js';

const auditoria = (db, accion) => db.prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id').all(accion);

// ---- Control de acceso por rol ----

test('sin sesión, el panel redirige al login (GET y POST)', async () => {
  const { app } = await crearEntorno();
  for (const url of ['/admin', '/admin/mesas', '/admin/agentes', '/admin/password', '/admin/modo', '/admin/bloqueos']) {
    const r = await get(app, url);
    assert.equal(r.statusCode, 302, url);
    assert.equal(r.headers.location, '/admin/login');
  }
  const r = await post(app, '/admin/mesas', { distrito: '1', seccion: '1', letra: 'A', censo: '10' });
  assert.equal(r.statusCode, 302);
});

test('una sesión de agente no accede al panel de administración', async () => {
  const { app, db } = await crearEntorno();
  const id = db.prepare("INSERT INTO agente (nombre, creado_en) VALUES ('Ana', 'x')").run().lastInsertRowid;
  const { token, csrf } = crearSesion(db, CONFIG.sessionSecret, 'agente', Number(id));
  for (const url of ['/admin', '/admin/mesas', '/admin/agentes', '/admin/modo', '/admin/bloqueos']) {
    assert.equal((await get(app, url, token)).statusCode, 403, url);
  }
  const r = await post(app, '/admin/mesas', { _csrf: csrf, distrito: '1', seccion: '1', letra: 'A', censo: '10' }, token);
  assert.equal(r.statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mesa').get().n, 6);
});

test('las operaciones POST exigen token CSRF válido', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  const datos = { distrito: '9', seccion: '9', letra: 'Z', censo: '10' };
  assert.equal((await post(app, '/admin/mesas', datos, cookie)).statusCode, 403);
  assert.equal((await post(app, '/admin/mesas', { ...datos, _csrf: 'falso' }, cookie)).statusCode, 403);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mesa').get().n, 6);
  assert.equal((await post(app, '/admin/mesas', { ...datos, _csrf: csrf }, cookie)).statusCode, 302);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mesa').get().n, 7);
});

// ---- Login ----

test('login correcto: cookie HttpOnly, Secure, SameSite=Lax y auditoría', async () => {
  const { app, db } = await crearEntorno();
  const { res, cookie } = await loginAdmin(app);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/admin');
  const c = cookieDe(res);
  assert.equal(c.httpOnly, true);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, 'Lax');
  assert.equal((await get(app, '/admin', cookie)).statusCode, 200);
  assert.equal(auditoria(db, 'login').length, 1);
});

test('login incorrecto: 401 con mensaje genérico y sin cookie', async () => {
  const { app } = await crearEntorno();
  const r = await intentarLogin(app, { usuario: 'admin', contrasena: 'mala' });
  assert.equal(r.statusCode, 401);
  assert.match(r.body, /Usuario o contraseña incorrectos/);
  assert.equal(cookieDe(r), undefined);
  const r2 = await intentarLogin(app, { usuario: 'noexiste', contrasena: 'mala' });
  assert.equal(r2.statusCode, 401);
  assert.match(r2.body, /Usuario o contraseña incorrectos/);
});

test('tras 5 fallos la IP se bloquea, incluso con la contraseña correcta; otra IP no', async () => {
  const { app } = await crearEntorno();
  const ip = { remoteAddress: '10.0.0.7' };
  for (let i = 0; i < MAX_FALLOS; i++) {
    assert.equal((await intentarLogin(app, { usuario: 'admin', contrasena: 'mala' }, ip)).statusCode, 401);
  }
  const bloqueado = await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, ip);
  assert.equal(bloqueado.statusCode, 429);
  assert.equal(cookieDe(bloqueado), undefined);
  const otra = await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, { remoteAddress: '10.0.0.8' });
  assert.equal(otra.statusCode, 302);
});

test('el login exige el token CSRF y su cookie', async () => {
  const { app, db } = await crearEntorno();
  const credenciales = { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial };
  const form = (datos) => new URLSearchParams(datos).toString();
  const cabecera = { 'content-type': 'application/x-www-form-urlencoded' };

  // El formulario trae token y cookie HttpOnly con ruta restringida
  const pagina = await get(app, '/admin/login');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)[1];
  const cookie = pagina.cookies.find((c) => c.name === 'csrf_login');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.path, '/admin/login');

  const intento = (payload, headers = {}) =>
    app.inject({ method: 'POST', url: '/admin/login', payload: form(payload), headers: { ...cabecera, ...headers } });
  // Sin token, sin cookie, token falso o cookie de otra emisión: todo rechazado
  assert.equal((await intento(credenciales, { cookie: `csrf_login=${cookie.value}` })).statusCode, 403);
  assert.equal((await intento({ ...credenciales, _csrf: csrf })).statusCode, 403);
  assert.equal((await intento({ ...credenciales, _csrf: 'falso' }, { cookie: `csrf_login=${cookie.value}` })).statusCode, 403);
  assert.equal((await intento({ ...credenciales, _csrf: csrf }, { cookie: 'csrf_login=otro-valor' })).statusCode, 403);
  const rechazado = await intento(credenciales);
  assert.equal(cookieDe(rechazado), undefined);
  assert.equal(auditoria(db, 'login').length, 0);

  // Con la pareja válida entra
  const ok = await intento({ ...credenciales, _csrf: csrf }, { cookie: `csrf_login=${cookie.value}` });
  assert.equal(ok.statusCode, 302);
});

test('un CSRF rechazado no consume intentos del límite por IP', async () => {
  const { app } = await crearEntorno();
  const ip = { remoteAddress: '10.0.0.9' };
  for (let i = 0; i < MAX_FALLOS + 2; i++) {
    const r = await app.inject({ method: 'POST', url: '/admin/login', payload: 'usuario=admin&contrasena=x', headers: { 'content-type': 'application/x-www-form-urlencoded' }, ...ip });
    assert.equal(r.statusCode, 403);
  }
  assert.equal((await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, ip)).statusCode, 302);
});

test('con TRUST_PROXY=2 la IP real es la del cliente y X-Forwarded-For falseado no evita el bloqueo', async () => {
  const { app } = await crearEntorno();
  // Cadena que ve la app: [falseada por el atacante], cliente real, Cloudflare; socket = NPM
  const cadena = (falsa) => ({
    remoteAddress: '172.18.0.2',
    headers: { 'x-forwarded-for': `${falsa}, 203.0.113.9, 172.70.1.1` },
  });
  for (let i = 0; i < MAX_FALLOS; i++) {
    const r = await intentarLogin(app, { usuario: 'admin', contrasena: 'mala' }, cadena(`198.51.100.${i}`));
    assert.equal(r.statusCode, 401);
  }
  const bloqueado = await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, cadena('198.51.100.200'));
  assert.equal(bloqueado.statusCode, 429);
  // Otro cliente real, con el mismo proxy, no queda afectado
  const otro = await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, {
    remoteAddress: '172.18.0.2',
    headers: { 'x-forwarded-for': '203.0.113.77, 172.70.1.1' },
  });
  assert.equal(otro.statusCode, 302);
});

test('un cliente que llega directo (par público) no puede falsear X-Forwarded-For', async () => {
  const { app } = await crearEntorno();
  for (let i = 0; i < MAX_FALLOS; i++) {
    const r = await intentarLogin(app, { usuario: 'admin', contrasena: 'mala' }, {
      remoteAddress: '203.0.113.50',
      headers: { 'x-forwarded-for': `198.51.100.${i}, 198.51.100.${i + 100}` },
    });
    assert.equal(r.statusCode, 401);
  }
  const r = await intentarLogin(app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, {
    remoteAddress: '203.0.113.50',
    headers: { 'x-forwarded-for': '198.51.100.250, 198.51.100.251' },
  });
  assert.equal(r.statusCode, 429);
});

test('cerrar sesión invalida la cookie', async () => {
  const { app } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  assert.equal((await post(app, '/admin/logout', { _csrf: csrf }, cookie)).statusCode, 302);
  assert.equal((await get(app, '/admin', cookie)).statusCode, 302);
});

// ---- Mesas ----

test('el administrador crea una mesa y edita su censo; todo queda auditado', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);

  const creada = await post(app, '/admin/mesas', { _csrf: csrf, distrito: '06', seccion: '1', letra: 'a', censo: '500' }, cookie);
  assert.equal(creada.statusCode, 302);
  const mesa = db.prepare("SELECT * FROM mesa WHERE codigo = '6-1-A'").get();
  assert.equal(mesa.censo, 500);

  const editada = await post(app, `/admin/mesas/${mesa.id}`, { _csrf: csrf, distrito: '6', seccion: '1', letra: 'A', censo: '520' }, cookie);
  assert.equal(editada.statusCode, 302);
  assert.equal(db.prepare('SELECT censo FROM mesa WHERE id = ?').get(mesa.id).censo, 520);

  const [edicion] = auditoria(db, 'editar');
  assert.equal(edicion.actor_tipo, 'admin');
  assert.equal(JSON.parse(edicion.valor_anterior).censo, 500);
  assert.equal(JSON.parse(edicion.valor_nuevo).censo, 520);
  assert.ok(edicion.fecha.endsWith('Z'));

  // Sin cambios no se audita
  await post(app, `/admin/mesas/${mesa.id}`, { _csrf: csrf, distrito: '6', seccion: '1', letra: 'A', censo: '520' }, cookie);
  assert.equal(auditoria(db, 'editar').length, 1);
});

test('validación de mesas: datos inválidos y códigos duplicados', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  const base = { _csrf: csrf, distrito: '4', seccion: '2', letra: 'A', censo: '10' };
  const duplicada = await post(app, '/admin/mesas', base, cookie);
  assert.equal(duplicada.statusCode, 422);
  assert.match(duplicada.body, /Ya existe la mesa 4-2-A/);
  for (const malo of [{ censo: '-1' }, { censo: 'abc' }, { censo: '' }, { distrito: 'x' }, { letra: '' }, { letra: 'ABCD' }]) {
    const r = await post(app, '/admin/mesas', { ...base, letra: 'Q', ...malo }, cookie);
    assert.equal(r.statusCode, 422, JSON.stringify(malo));
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mesa').get().n, 6);
  // El formulario conserva lo escrito
  const r = await post(app, '/admin/mesas', { ...base, letra: 'Q', censo: 'abc' }, cookie);
  assert.match(r.body, /value="abc"/);
});

test('baja y alta de mesa (no se borra) con auditoría', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  const id = db.prepare("SELECT id FROM mesa WHERE codigo = '4-2-A'").get().id;
  await post(app, `/admin/mesas/${id}/estado`, { _csrf: csrf }, cookie);
  assert.equal(db.prepare('SELECT activa FROM mesa WHERE id = ?').get(id).activa, 0);
  await post(app, `/admin/mesas/${id}/estado`, { _csrf: csrf }, cookie);
  assert.equal(db.prepare('SELECT activa FROM mesa WHERE id = ?').get(id).activa, 1);
  assert.equal(auditoria(db, 'baja').length, 1);
  assert.equal(auditoria(db, 'alta').length, 1);
});

test('el listado de mesas muestra el censo total', async () => {
  const { app } = await crearEntorno();
  const { cookie } = await loginAdmin(app);
  const r = await get(app, '/admin/mesas', cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /4-2-A/);
  assert.match(r.body, /<th class="num">4181<\/th>/);
});

// ---- Agentes y PIN ----

async function crearAgente(app, csrf, cookie, nombre, mesas) {
  const pares = [['_csrf', csrf], ['nombre', nombre], ...mesas.map((m) => ['mesas', String(m)])];
  return app.inject({
    method: 'POST',
    url: '/admin/agentes',
    payload: new URLSearchParams(pares).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sid=${cookie}` },
  });
}

test('el administrador crea un agente, le asigna mesas y obtiene su PIN', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  const mesas = db.prepare("SELECT id FROM mesa WHERE codigo IN ('4-2-A', '4-2-B') ORDER BY codigo").all().map((m) => m.id);

  const creado = await crearAgente(app, csrf, cookie, '  María   López ', mesas);
  assert.equal(creado.statusCode, 302);
  const agente = db.prepare('SELECT * FROM agente').get();
  assert.equal(agente.nombre, 'María López');
  assert.equal(agente.pin_hmac, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agente_mesa WHERE agente_id = ?').get(agente.id).n, 2);

  const conPin = await post(app, `/admin/agentes/${agente.id}/pin`, { _csrf: csrf }, cookie);
  assert.equal(conPin.statusCode, 200);
  assert.match(conPin.headers['cache-control'], /no-store/);
  const pin = /class="pin"[^>]*>(\d{6})</.exec(conPin.body)?.[1];
  assert.ok(pin, 'la respuesta debe mostrar un PIN de 6 dígitos');

  const fila = db.prepare('SELECT pin_hmac FROM agente WHERE id = ?').get(agente.id);
  assert.equal(fila.pin_hmac, hmacPin(CONFIG.pinHmacSecret, pin));
  assert.notEqual(fila.pin_hmac, pin);

  // El PIN no aparece en la auditoría ni vuelve a mostrarse en la ficha
  const todaAuditoria = JSON.stringify(db.prepare('SELECT * FROM auditoria').all());
  assert.ok(!todaAuditoria.includes(pin));
  const ficha = await get(app, `/admin/agentes/${agente.id}`, cookie);
  assert.ok(!ficha.body.includes(pin));
  assert.equal(auditoria(db, 'generar_pin').length, 1);
});

test('regenerar el PIN cambia el HMAC y revocar lo elimina e invalida sus sesiones', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  await crearAgente(app, csrf, cookie, 'Luis', []);
  const agente = db.prepare('SELECT * FROM agente').get();

  await post(app, `/admin/agentes/${agente.id}/pin`, { _csrf: csrf }, cookie);
  const primero = db.prepare('SELECT pin_hmac FROM agente WHERE id = ?').get(agente.id).pin_hmac;
  crearSesion(db, CONFIG.sessionSecret, 'agente', agente.id);

  await post(app, `/admin/agentes/${agente.id}/pin`, { _csrf: csrf }, cookie);
  const segundo = db.prepare('SELECT pin_hmac FROM agente WHERE id = ?').get(agente.id).pin_hmac;
  assert.notEqual(primero, segundo);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sesion WHERE actor_tipo = 'agente'").get().n, 0, 'regenerar invalida sesiones');
  assert.equal(auditoria(db, 'regenerar_pin').length, 1);

  crearSesion(db, CONFIG.sessionSecret, 'agente', agente.id);
  await post(app, `/admin/agentes/${agente.id}/pin/revocar`, { _csrf: csrf }, cookie);
  assert.equal(db.prepare('SELECT pin_hmac FROM agente WHERE id = ?').get(agente.id).pin_hmac, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sesion WHERE actor_tipo = 'agente'").get().n, 0);
  assert.equal(auditoria(db, 'revocar_pin').length, 1);
});

test('dar de baja a un agente anula su PIN y no permite generar otro', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  await crearAgente(app, csrf, cookie, 'Eva', []);
  const { id } = db.prepare('SELECT id FROM agente').get();
  await post(app, `/admin/agentes/${id}/pin`, { _csrf: csrf }, cookie);
  await post(app, `/admin/agentes/${id}/estado`, { _csrf: csrf }, cookie);
  const baja = db.prepare('SELECT activo, pin_hmac FROM agente WHERE id = ?').get(id);
  assert.deepEqual({ ...baja }, { activo: 0, pin_hmac: null });
  assert.equal((await post(app, `/admin/agentes/${id}/pin`, { _csrf: csrf }, cookie)).statusCode, 409);
  await post(app, `/admin/agentes/${id}/estado`, { _csrf: csrf }, cookie);
  assert.equal(db.prepare('SELECT activo FROM agente WHERE id = ?').get(id).activo, 1);
});

test('editar agente cambia nombre y mesas; varios agentes pueden compartir mesa', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  const mesa = db.prepare("SELECT id FROM mesa WHERE codigo = '4-3-A'").get().id;
  await crearAgente(app, csrf, cookie, 'Uno', [mesa]);
  await crearAgente(app, csrf, cookie, 'Dos', [mesa]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agente_mesa WHERE mesa_id = ?').get(mesa).n, 2);

  const { id } = db.prepare("SELECT id FROM agente WHERE nombre = 'Uno'").get();
  await post(app, `/admin/agentes/${id}`, { _csrf: csrf, nombre: 'Uno Renombrado' }, cookie);
  assert.equal(db.prepare('SELECT nombre FROM agente WHERE id = ?').get(id).nombre, 'Uno Renombrado');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agente_mesa WHERE agente_id = ?').get(id).n, 0);
  const [cambio] = auditoria(db, 'editar');
  assert.deepEqual(JSON.parse(cambio.valor_anterior).mesas, ['4-3-A']);
  assert.deepEqual(JSON.parse(cambio.valor_nuevo).mesas, []);
});

test('validación de agentes: nombre obligatorio y mesas existentes', async () => {
  const { app, db } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  assert.equal((await crearAgente(app, csrf, cookie, '   ', [])).statusCode, 422);
  assert.equal((await crearAgente(app, csrf, cookie, 'x'.repeat(81), [])).statusCode, 422);
  assert.equal((await crearAgente(app, csrf, cookie, 'Ok', [9999])).statusCode, 422);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM agente').get().n, 0);
});

test('el nombre del agente se escapa en el HTML', async () => {
  const { app } = await crearEntorno();
  const { cookie, csrf } = await loginAdmin(app);
  await crearAgente(app, csrf, cookie, '<script>alert(1)</script>', []);
  const r = await get(app, '/admin/agentes', cookie);
  assert.ok(!r.body.includes('<script>alert(1)'));
  assert.match(r.body, /&lt;script&gt;/);
});

// ---- Contraseña ----

test('cambiar la contraseña: valida, cierra otras sesiones y permite entrar con la nueva', async () => {
  const { app, db } = await crearEntorno();
  const a = await loginAdmin(app);
  const b = await loginAdmin(app);
  const datos = { _csrf: a.csrf, actual: CONFIG.adminPasswordInitial, nueva: 'nueva-contraseña-1', repetir: 'nueva-contraseña-1' };

  assert.equal((await post(app, '/admin/password', { ...datos, actual: 'mal' }, a.cookie)).statusCode, 422);
  assert.equal((await post(app, '/admin/password', { ...datos, nueva: 'corta', repetir: 'corta' }, a.cookie)).statusCode, 422);
  assert.equal((await post(app, '/admin/password', { ...datos, repetir: 'distinta-contraseña' }, a.cookie)).statusCode, 422);
  assert.equal(auditoria(db, 'cambiar_password').length, 0);

  assert.equal((await post(app, '/admin/password', datos, a.cookie)).statusCode, 302);
  assert.equal((await get(app, '/admin', a.cookie)).statusCode, 200, 'la sesión actual se mantiene');
  assert.equal((await get(app, '/admin', b.cookie)).statusCode, 302, 'las demás sesiones se cierran');
  assert.equal((await loginAdmin(app, CONFIG.adminPasswordInitial)).res.statusCode, 401);
  assert.equal((await loginAdmin(app, 'nueva-contraseña-1')).res.statusCode, 302);
  const registro = JSON.stringify(auditoria(db, 'cambiar_password'));
  assert.ok(!registro.includes('nueva-contraseña-1'));
});
