import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIMITES, estaBloqueada, registrarFallo } from '../src/limiteIntentos.js';
import { CONFIG, crearEntorno, crearReloj, get, intentarLogin, loginAdmin, post } from './ayuda.js';

const DIA = '2026-11-29T10:00:00Z';
const BANNER = 'MODO DEMO - datos de prueba';
const auditoria = (db, accion) => db.prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id').all(accion);

async function entorno(iso) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  return { ...e, ...(await loginAdmin(e.app)) };
}
const cambiar = (e, datos) => post(e.app, '/admin/modo/cambiar', { _csrf: e.csrf, ...datos }, e.cookie);

test('la pantalla de modo muestra modo, motivo, fecha y hora del servidor en Madrid', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const r = await get(e.app, '/admin/modo', e.cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Modo actual: <strong>DEMO<\/strong>/);
  assert.match(r.body, /Automático: aún no ha llegado la fecha de elecciones/);
  assert.match(r.body, /29\/11\/2026/);
  assert.match(r.body, /20\/10\/2026 12:00:00/, 'hora de Madrid (CEST) del reloj simulado');
  assert.match(r.body, /Pasar a REAL/);
  assert.match(r.body, /Reiniciar demo/);
  assert.ok(!r.body.includes('Pasar a DEMO'));
});

test('banner naranja en TODAS las pantallas en DEMO; en REAL solo un indicador discreto', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  for (const url of ['/', '/admin/login']) assert.ok((await get(e.app, url)).body.includes(BANNER), url);
  for (const url of ['/admin', '/admin/mesas', '/admin/agentes', '/admin/modo', '/admin/bloqueos', '/admin/password']) {
    assert.ok((await get(e.app, url, e.cookie)).body.includes(BANNER), url);
  }
  assert.match((await get(e.app, '/')).body, /Modo DEMO|MODO DEMO<\/strong>/);

  e.reloj.fijar(DIA);
  for (const url of ['/', '/admin/login']) {
    const r = await get(e.app, url);
    assert.ok(!r.body.includes(BANNER), url);
    assert.match(r.body, /Modo REAL/);
    assert.match(r.body, /barra-real/);
  }
  assert.ok(!(await get(e.app, '/admin/modo', e.cookie)).body.includes(BANNER));
});

test('/healthz y /version incluyen el modo', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  assert.equal((await get(e.app, '/healthz')).json().modo, 'DEMO');
  e.reloj.fijar(DIA);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'REAL');
  assert.equal((await get(e.app, '/version')).json().modo, 'REAL');
});

test('pasar a REAL pide contraseña y la palabra REAL; no exige confirmación reforzada', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const mal = await cambiar(e, { destino: 'REAL', contrasena: 'incorrecta', palabra: 'REAL' });
  assert.equal(mal.statusCode, 422);
  assert.equal(e.db.prepare("SELECT fallos FROM bloqueo_ip WHERE ambito = 'admin'").get().fallos, 1, 'cuenta como fallo de administrador');
  const sinPalabra = await cambiar(e, { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'DEMO' });
  assert.equal(sinPalabra.statusCode, 422);
  assert.match(sinPalabra.body, /escribe exactamente REAL/);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'DEMO', 'sin cambios si falla algo');
  assert.ok(existsSync(path.join(e.dataDir, 'demo.db')));

  const ok = await cambiar(e, { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: ' real ' });
  assert.equal(ok.statusCode, 302);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'REAL');
  assert.ok(!existsSync(path.join(e.dataDir, 'demo.db')));
  const fila = auditoria(e.db, 'cambiar_modo')[0];
  assert.equal(fila.actor_tipo, 'admin');
  assert.deepEqual(JSON.parse(fila.valor_nuevo), { modo: 'REAL', origen: 'manual', en_jornada: false });
  assert.match((await get(e.app, '/admin/modo', e.cookie)).body, /Manual: fijado el/);
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM bloqueo_ip WHERE ambito = 'admin'").get().n, 0, 'el éxito limpia el contador');
});

test('al salir de DEMO se avisa de cuántos registros se perderán', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const mesa = e.db.prepare('SELECT id FROM mesa LIMIT 1').get().id;
  const cortes = e.db.prepare('SELECT id FROM corte ORDER BY orden').all();
  e.app.datos.sincronizar();
  const captura = e.app.datos.captura();
  cortes.slice(0, 3).forEach((c, i) => captura.guardarParticipacion({ mesaId: mesa, corteId: c.id, votantes: i + 1, actor: { tipo: 'admin', id: 1 } }));
  const r = await get(e.app, '/admin/modo', e.cookie);
  assert.match(r.body, /Se eliminarán 3 registros de la demo/);
});

test('el día de las elecciones pasar a DEMO exige «DEMO EN JORNADA» y queda en la auditoría real', async () => {
  const e = await entorno(DIA);
  const pagina = await get(e.app, '/admin/modo', e.cookie);
  assert.match(pagina.body, /Modo actual: <strong>REAL<\/strong>/);
  assert.match(pagina.body, /Automático: ha llegado la fecha de elecciones/);
  assert.match(pagina.body, /DEMO EN JORNADA/);
  assert.ok(!pagina.body.includes('Reiniciar demo'), 'Reiniciar demo solo es visible en DEMO');

  const simple = await cambiar(e, { destino: 'DEMO', contrasena: CONFIG.adminPasswordInitial, palabra: 'DEMO' });
  assert.equal(simple.statusCode, 422);
  assert.match(simple.body, /DEMO EN JORNADA/);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'REAL');

  const ok = await cambiar(e, { destino: 'DEMO', contrasena: CONFIG.adminPasswordInitial, palabra: 'demo en jornada' });
  assert.equal(ok.statusCode, 302);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'DEMO');
  assert.equal(JSON.parse(auditoria(e.db, 'cambiar_modo')[0].valor_nuevo).en_jornada, true);
  assert.ok((await get(e.app, '/admin/modo', e.cookie)).body.includes('Reiniciar demo'));

  // Volver a REAL a mano no exige la confirmación reforzada
  const vuelta = await cambiar(e, { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' });
  assert.equal(vuelta.statusCode, 302);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'REAL');
});

test('Reiniciar demo: solo en DEMO, borra la demo y no toca los datos reales', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const mesa = e.db.prepare('SELECT id FROM mesa LIMIT 1').get().id;
  const corte = e.db.prepare('SELECT id FROM corte LIMIT 1').get().id;
  e.app.datos.sincronizar();
  e.app.datos.captura().guardarParticipacion({ mesaId: mesa, corteId: corte, votantes: 5, actor: { tipo: 'admin', id: 1 } });
  const realAntes = JSON.stringify(e.db.prepare('SELECT * FROM participacion').all());

  assert.equal((await post(e.app, '/admin/modo/reiniciar-demo', { _csrf: e.csrf }, e.cookie)).statusCode, 302);
  assert.equal(e.app.datos.contarRegistrosDemo(), 0);
  assert.equal(JSON.stringify(e.db.prepare('SELECT * FROM participacion').all()), realAntes);

  e.reloj.fijar(DIA);
  const enReal = await post(e.app, '/admin/modo/reiniciar-demo', { _csrf: e.csrf }, e.cookie);
  assert.equal(enReal.statusCode, 409);
});

test('el cambio de modo exige sesión de administrador y CSRF', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const sinCsrf = await post(e.app, '/admin/modo/cambiar', { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' }, e.cookie);
  assert.equal(sinCsrf.statusCode, 403);
  const anonimo = await post(e.app, '/admin/modo/cambiar', { destino: 'REAL' });
  assert.equal(anonimo.statusCode, 302);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'DEMO');
});

// ---- Contadores de intentos separados y desbloqueo de IP ----

test('contadores separados: bloquear al administrador no bloquea el PIN de los agentes y viceversa', async () => {
  const e = await crearEntorno();
  const ip = '198.51.100.20';
  for (let i = 0; i < LIMITES.admin.max; i++) registrarFallo(e.db, 'admin', ip);
  assert.equal(estaBloqueada(e.db, 'admin', ip), true);
  assert.equal(estaBloqueada(e.db, 'pin', ip), false, 'los agentes de la misma IP siguen pudiendo entrar');

  for (let i = 0; i < LIMITES.pin.max - 1; i++) registrarFallo(e.db, 'pin', ip);
  assert.equal(estaBloqueada(e.db, 'pin', ip), false, '14 fallos de PIN no bloquean');
  registrarFallo(e.db, 'pin', ip);
  assert.equal(estaBloqueada(e.db, 'pin', ip), true, 'el 15.º sí');

  const otra = '198.51.100.21';
  for (let i = 0; i < LIMITES.pin.max; i++) registrarFallo(e.db, 'pin', otra);
  assert.equal(estaBloqueada(e.db, 'admin', otra), false);
  assert.equal(estaBloqueada(e.db, 'pin', '198.51.100.22'), false, 'otra IP no se ve afectada');
});

test('PIN: 15 fallos en 5 minutos bloquean 5 minutos; la ventana y el bloqueo caducan', async () => {
  const e = await crearEntorno();
  const ip = '198.51.100.30';
  const t0 = Date.parse('2026-10-20T10:00:00Z');
  assert.deepEqual({ ...LIMITES.pin }, { max: 15, ventanaMs: 300000, bloqueoMs: 300000 });

  // 14 fallos en la ventana y el siguiente fuera de ella: la cuenta se reinicia
  for (let i = 0; i < 14; i++) registrarFallo(e.db, 'pin', ip, t0 + i * 1000);
  registrarFallo(e.db, 'pin', ip, t0 + 6 * 60 * 1000);
  assert.equal(estaBloqueada(e.db, 'pin', ip, t0 + 6 * 60 * 1000), false);
  assert.equal(e.db.prepare("SELECT fallos FROM bloqueo_ip WHERE ambito = 'pin' AND ip = ?").get(ip).fallos, 1);

  // 15 dentro de la ventana bloquean exactamente 5 minutos
  const t1 = t0 + 60 * 60 * 1000;
  for (let i = 0; i < 15; i++) registrarFallo(e.db, 'pin', ip, t1 + i * 1000);
  assert.equal(estaBloqueada(e.db, 'pin', ip, t1 + 20 * 1000), true);
  assert.equal(estaBloqueada(e.db, 'pin', ip, t1 + 14 * 1000 + 299 * 1000), true);
  assert.equal(estaBloqueada(e.db, 'pin', ip, t1 + 14 * 1000 + 301 * 1000), false);
});

test('los fallos de contraseña de la pantalla de modo bloquean al administrador, nunca a los agentes', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  for (let i = 0; i < LIMITES.admin.max; i++) {
    const r = await cambiar(e, { destino: 'REAL', contrasena: 'mala', palabra: 'REAL' });
    assert.equal(r.statusCode, 422);
  }
  const bloqueada = await cambiar(e, { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' });
  assert.equal(bloqueada.statusCode, 429);
  assert.equal((await get(e.app, '/healthz')).json().modo, 'DEMO');
  const ip = '127.0.0.1';
  assert.equal(estaBloqueada(e.db, 'admin', ip), true);
  assert.equal(estaBloqueada(e.db, 'pin', ip), false);
  // También se bloquea el login de administrador desde esa IP
  assert.equal((await intentarLogin(e.app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial })).statusCode, 429);
});

test('Desbloquear IP: lista bloqueos, desbloquea por ámbito o todas, valida y audita', async () => {
  const e = await entorno('2026-10-20T10:00:00Z');
  const ip = '198.51.100.40';
  for (let i = 0; i < LIMITES.admin.max; i++) registrarFallo(e.db, 'admin', ip);
  for (let i = 0; i < LIMITES.pin.max; i++) registrarFallo(e.db, 'pin', ip);

  const lista = await get(e.app, '/admin/bloqueos', e.cookie);
  assert.equal(lista.statusCode, 200);
  assert.match(lista.body, /198\.51\.100\.40/);
  assert.match(lista.body, /Bloqueada hasta/);
  assert.match(lista.body, /Tu IP actual: <strong>127\.0\.0\.1<\/strong>/);

  assert.equal((await post(e.app, '/admin/bloqueos/desbloquear', { _csrf: e.csrf, ip: 'no-es-ip', ambito: 'todos' }, e.cookie)).statusCode, 422);
  assert.equal((await post(e.app, '/admin/bloqueos/desbloquear', { _csrf: e.csrf, ip, ambito: 'otro' }, e.cookie)).statusCode, 422);
  assert.equal(estaBloqueada(e.db, 'admin', ip), true);

  assert.equal((await post(e.app, '/admin/bloqueos/desbloquear', { _csrf: e.csrf, ip, ambito: 'pin' }, e.cookie)).statusCode, 302);
  assert.equal(estaBloqueada(e.db, 'pin', ip), false);
  assert.equal(estaBloqueada(e.db, 'admin', ip), true, 'solo se desbloquea el ámbito pedido');

  assert.equal((await post(e.app, '/admin/bloqueos/desbloquear', { _csrf: e.csrf, ip, ambito: 'todos' }, e.cookie)).statusCode, 302);
  assert.equal(estaBloqueada(e.db, 'admin', ip), false);

  registrarFallo(e.db, 'pin', '198.51.100.41');
  assert.equal((await post(e.app, '/admin/bloqueos/desbloquear', { _csrf: e.csrf, todas: '1' }, e.cookie)).statusCode, 302);
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM bloqueo_ip').get().n, 0);
  assert.equal(auditoria(e.db, 'desbloquear_ip').length, 3);
});
