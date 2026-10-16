import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { crearSesion } from '../src/sesiones.js';
import { CONFIG, crearAgente, crearEntorno, crearReloj, get, getAgente, loginAdmin, loginAgente, post } from './ayuda.js';

const BANNER = 'MODO DEMO - datos de prueba';
const DEMO_12H34 = '2026-10-20T10:34:56Z'; // 12:34:56 en Madrid (CEST), antes de las elecciones: DEMO
const REAL_12H34 = '2026-11-29T11:34:56Z'; // 12:34:56 en Madrid (CET), día de las elecciones: REAL

async function entorno(iso = DEMO_12H34) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const sesion = await loginAdmin(e.app);
  const mesa = (codigo) => e.db.prepare('SELECT id FROM mesa WHERE codigo = ?').get(codigo).id;
  const corte = (hora) => e.db.prepare('SELECT id FROM corte WHERE hora = ?').get(hora).id;
  const rellenar = (matriz, actor = { tipo: 'agente', id: 1 }) => {
    e.app.datos.sincronizar();
    const captura = e.app.datos.captura();
    for (const [codigo, porCorte] of Object.entries(matriz)) {
      for (const [hora, votantes] of Object.entries(porCorte)) {
        captura.guardarParticipacion({ mesaId: mesa(codigo), corteId: corte(hora), votantes, actor });
      }
    }
  };
  return { ...e, ...sesion, mesa, corte, rellenar };
}
// Datos de ejemplo: 4/6 mesas a las 10:00 y 2/6 a las 12:00.
const DATOS = {
  '4-2-A': { '10:00': 100, '12:00': 250 },
  '4-2-B': { '10:00': 90, '12:00': 230 },
  '4-3-A': { '10:00': 150 },
  '4-3-B': { '10:00': 200 },
};
const completar = (e) => e.rellenar({ '4-3-A': { '12:00': 300 }, '4-3-B': { '12:00': 400 }, '5-18-U': { '12:00': 300 }, '5-31-U': { '12:00': 300 } });

const post_ = (e, url, datos) => post(e.app, url, { _csrf: e.csrf, ...datos }, e.cookie);
const auditoria = (db, accion) => db.prepare('SELECT * FROM auditoria WHERE accion = ? ORDER BY id').all(accion);

// ---------------- Permisos ----------------

test('las pantallas nuevas exigen sesión de administrador (anónimo: login; agente: 403)', async () => {
  const e = await entorno();
  const urls = ['/admin/resumen', '/pantallazo', '/pantallazo?variante=ultimo', '/admin/historico', '/admin/cortes'];
  for (const url of urls) {
    const anonimo = await get(e.app, url);
    assert.equal(anonimo.statusCode, 302, url);
    assert.equal(anonimo.headers.location, '/admin/login');
  }
  assert.equal((await post(e.app, '/admin/cortes', { hora_1: '09:00' })).statusCode, 302);

  const agente = crearAgente(e.db);
  const sesion = await loginAgente(e.app, agente.pin);
  const comoSid = crearSesion(e.db, CONFIG.sessionSecret, 'agente', agente.id);
  for (const url of urls) {
    assert.equal((await get(e.app, url, comoSid.token)).statusCode, 403, `${url} con sesión de agente`);
    const conCookieAgente = await e.app.inject({ method: 'GET', url, headers: { cookie: `sid_agente=${sesion.cookie}` } });
    assert.equal(conCookieAgente.statusCode, 302, `${url} con la cookie normal del agente`);
  }
  const horas = e.db.prepare('SELECT hora FROM corte ORDER BY orden').all().map((c) => c.hora);
  await post(e.app, '/admin/cortes', { _csrf: comoSid.csrf, hora_1: '09:00' }, comoSid.token);
  assert.deepEqual(e.db.prepare('SELECT hora FROM corte ORDER BY orden').all().map((c) => c.hora), horas, 'un agente no cambia los cortes');
});

// ---------------- Panel resumen ----------------

test('panel resumen: acumulado, parcial y % por mesa y corte; totales; mesas informadas y pendientes', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  const r = await get(e.app, '/admin/resumen', e.cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<th class="num">10:00<span class="faltan">4\/6<\/span><\/th>/);
  assert.match(r.body, /<th class="num">12:00<span class="faltan">2\/6<\/span><\/th>/);
  assert.match(r.body, /<th class="num">14:00<span class="faltan">0\/6<\/span><\/th>/);
  // 4-2-A a las 10:00: 100 acumulado, +100 parcial, 16,3 % de 615
  assert.match(r.body, /<strong>100<\/strong><small>\+100<\/small><small>16,3%<\/small>/);
  // a las 12:00: 250, +150, 40,7 %
  assert.match(r.body, /<strong>250<\/strong><small>\+150<\/small><small>40,7%<\/small>/);
  // Totales: 540 (4 mesas, censo 2813) y 480 (2 mesas, censo 1238)
  assert.match(r.body, /<tfoot>.*<strong>540<\/strong><small>\+540<\/small><small>19,2%<\/small>/s);
  assert.match(r.body, /<strong>480<\/strong><small>\+290<\/small><small>38,8%<\/small>/);
  assert.match(r.body, /PROVISIONAL · 2\/6 mesas en el corte de las 12:00/);
  assert.match(r.body, /Faltan por informar \(corte de las 12:00\): <strong><span class="cod">4-3-A<\/span>, <span class="cod">4-3-B<\/span>, <span class="cod">5-18-U<\/span>, <span class="cod">5-31-U<\/span><\/strong>/);
  assert.match(r.body, /href="\/admin\/participacion\/\d+\/\d+"/, 'cada celda lleva a la ficha de edición');
});

test('panel resumen: hora de la última actualización visible, sondeo y banner de modo', async () => {
  const e = await entorno();
  const r = await get(e.app, '/admin/resumen', e.cookie);
  assert.match(r.body, /Actualizado: <time id="hora-actualizacion">12:34:56<\/time>/);
  assert.match(r.body, /20\/10\/2026 · hora de Madrid/);
  assert.match(r.body, /id="sondeo" data-intervalo="5000"/);
  assert.match(r.body, /<script src="\/resumen\.js\?v=[\d.]+" defer><\/script>/);
  assert.match(r.body, /PROVISIONAL · sin datos todavía/);
  assert.ok(r.body.includes(BANNER));

  e.reloj.fijar(REAL_12H34);
  const real = await get(e.app, '/admin/resumen', e.cookie);
  assert.ok(!real.body.includes(BANNER));
  assert.match(real.body, /Modo REAL/);
});

test('el panel refleja los datos nuevos en la siguiente petición (lo que usa el sondeo) y el modo en que está', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  assert.match((await get(e.app, '/admin/resumen', e.cookie)).body, /2\/6<\/span><\/th>/);
  completar(e);
  const despues = await get(e.app, '/admin/resumen', e.cookie);
  assert.match(despues.body, /<th class="num">12:00<span class="faltan">6\/6<\/span><\/th>/);
  assert.match(despues.body, /COMPLETO · 6\/6 mesas en el corte de las 12:00/);
  assert.ok(!despues.body.includes('Faltan por informar'));
  // El panel de DEMO no muestra datos reales: tras pasar a REAL parte de cero
  await post_(e, '/admin/modo/cambiar', { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' });
  const real = await get(e.app, '/admin/resumen', e.cookie);
  assert.match(real.body, /PROVISIONAL · sin datos todavía/);
});

test('las mesas de baja no cuentan en el resumen', async () => {
  const e = await entorno();
  e.rellenar({ '5-31-U': { '10:00': 50 }, '4-2-A': { '10:00': 100 } });
  e.db.prepare("UPDATE mesa SET activa = 0 WHERE codigo = '5-31-U'").run();
  const r = await get(e.app, '/admin/resumen', e.cookie);
  assert.match(r.body, /<span class="faltan">1\/5<\/span>/);
  assert.ok(!r.body.includes('5-31-U'));
  assert.match(r.body, /<strong>100<\/strong><small>\+100<\/small><small>16,3%<\/small>[\s\S]*<tfoot>/);
});

// ---------------- /pantallazo ----------------

const pantallazo = (e, variante = '') => get(e.app, `/pantallazo${variante ? `?variante=${variante}` : ''}`, e.cookie);

test('pantallazo: título con colegio y tipo de elección, hora de actualización muy visible, sin menús', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  for (const variante of ['', 'participacion', 'ultimo']) {
    const r = await pantallazo(e, variante);
    assert.equal(r.statusCode, 200, variante);
    assert.match(r.body, /<h1>Colegio Dulcinea<\/h1>/);
    assert.match(r.body, /Elecciones Generales · (Participación|Último corte)/);
    assert.match(r.body, /Actualizado <time id="hora-actualizacion">12:34:56<\/time>/);
    assert.match(r.body, /20\/10\/2026 · hora de Madrid/);
    assert.match(r.body, /<body class="pantallazo">/);
    assert.ok(!/<nav class="nav"/.test(r.body), 'sin menú de administración');
    assert.ok(!r.body.includes('Cerrar sesión') && !/action="\/admin\/logout"/.test(r.body));
    assert.match(r.body, /id="sondeo" data-intervalo="10000"/);
  }
});

test('pantallazo «Participación»: mesas en filas, solo los cortes con datos y cabeceras abreviadas, total y %', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  const r = await pantallazo(e, 'participacion');
  assert.match(r.body, /<thead><tr><th>Mesa<\/th><th>10h<\/th><th>12h<\/th><\/tr><\/thead>/, 'solo 10h y 12h (no hay datos de 14h, 16h...)');
  assert.match(r.body, /<th scope="row">4-2-A<\/th><td><span class="v">100<\/span><span class="p">16,3%<\/span><\/td><td><span class="v">250<\/span><span class="p">40,7%<\/span><\/td>/);
  assert.match(r.body, /<th scope="row">4-3-A<\/th><td><span class="v">150<\/span><span class="p">19,9%<\/span><\/td><td class="vacia">–<\/td>/);
  assert.match(r.body, /<th scope="row">5-18-U<\/th><td class="vacia">–<\/td><td class="vacia">–<\/td>/);
  assert.match(r.body, /<tr class="total"><th scope="row">TOTAL<\/th><td><span class="v">540<\/span><span class="p">19,2%<\/span><\/td><td><span class="v">480<\/span><span class="p">38,8%<\/span><\/td>/);
  assert.match(r.body, /<tr class="informadas"><th scope="row">Mesas<\/th><td>4\/6<\/td><td>2\/6<\/td>/);
  assert.match(r.body, /TOTAL: % sobre el censo de las mesas informadas/);
  assert.ok(!/<th>14h<\/th>/.test(r.body));
});

test('pantallazo «Último corte»: acumulado, parcial y % por mesa, y total', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  const r = await pantallazo(e, 'ultimo');
  assert.match(r.body, /Corte de las <strong>12:00<\/strong>/);
  assert.match(r.body, /<thead><tr><th>Mesa<\/th><th>Acum\.<\/th><th>Parcial<\/th><th>%<\/th><\/tr><\/thead>/);
  assert.match(r.body, /<th scope="row">4-2-A<\/th><td><span class="v">250<\/span><\/td><td>\+150<\/td><td>40,7%<\/td>/);
  assert.match(r.body, /<tr class="vacia"><th scope="row">4-3-A<\/th><td colspan="3">sin dato<\/td><\/tr>/);
  assert.match(r.body, /<tr class="total"><th scope="row">TOTAL<\/th><td><span class="v">480<\/span><\/td><td>\+290<\/td><td>38,8%<\/td>/);
});

test('pantallazo: «Provisional» mientras falten mesas; «Completo» cuando están todas', async () => {
  const e = await entorno();
  assert.match((await pantallazo(e)).body, /sello provisional">PROVISIONAL · sin datos todavía/);
  assert.match((await pantallazo(e)).body, /Todavía no hay datos de participación/);
  e.rellenar(DATOS);
  for (const v of ['participacion', 'ultimo']) {
    const r = await pantallazo(e, v);
    assert.match(r.body, /sello provisional">PROVISIONAL · 2\/6 mesas en el corte de las 12:00/, v);
    assert.ok(!r.body.includes('COMPLETO'), v);
  }
  completar(e);
  for (const v of ['participacion', 'ultimo']) {
    const r = await pantallazo(e, v);
    assert.match(r.body, /sello completo">COMPLETO · 6\/6 mesas en el corte de las 12:00/, v);
    assert.ok(!r.body.includes('PROVISIONAL'), v);
  }
});

test('pantallazo en DEMO: marca de agua «DEMO» dentro del lienzo en todas las variantes; en REAL no hay ninguna', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  for (const variante of ['', 'participacion', 'ultimo', 'recuento', 'inventada']) {
    const r = await pantallazo(e, variante);
    assert.match(r.body, /<div class="lienzo" id="lienzo">\s*<div class="marca-agua" aria-hidden="true"><span>DEMO<\/span><\/div>/, `marca dentro del lienzo (${variante})`);
    assert.match(r.body, /sello demo">DEMO · DATOS DE PRUEBA/);
    assert.ok(r.body.includes(BANNER));
    assert.match(r.body, /<title>DEMO · Pantallazo/);
    assert.match(r.body, /<textarea[^>]*>\*\*\* DEMO - DATOS DE PRUEBA, NO SON REALES \*\*\*/, 'el texto para WhatsApp también va marcado');
  }
  // En REAL: ni marca, ni sello, ni la palabra DEMO en ninguna parte de la página
  e.reloj.fijar(REAL_12H34);
  for (const variante of ['participacion', 'ultimo']) {
    const r = await pantallazo(e, variante);
    assert.equal(r.statusCode, 200);
    assert.ok(!r.body.includes('marca-agua'), variante);
    assert.ok(!/DEMO/.test(r.body), `no debe aparecer «DEMO» en REAL (${variante})`);
  }
});

test('la marca de agua sigue al modo: al cambiar a REAL desaparece en la siguiente carga (la que hace el sondeo)', async () => {
  const e = await entorno();
  assert.ok((await pantallazo(e)).body.includes('marca-agua'));
  await post_(e, '/admin/modo/cambiar', { destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' });
  assert.ok(!(await pantallazo(e)).body.includes('marca-agua'));
  await post_(e, '/admin/modo/cambiar', { destino: 'DEMO', contrasena: CONFIG.adminPasswordInitial, palabra: 'DEMO' });
  assert.ok((await pantallazo(e)).body.includes('marca-agua'));
});

test('pantallazo: selector de variantes con el recuento preparado pero desactivado, y botón de copiar con el texto', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  const r = await pantallazo(e, 'ultimo');
  assert.match(r.body, /<a class="pildora" href="\/pantallazo\?variante=participacion">Participación<\/a>/);
  assert.match(r.body, /<a class="pildora activa" href="\/pantallazo\?variante=ultimo" aria-current="true">Último corte<\/a>/);
  assert.match(r.body, /<span class="pildora desactivada" aria-disabled="true"[^>]*>Recuento<\/span>/);
  assert.ok(!/href="\/pantallazo\?variante=recuento"/.test(r.body), 'el recuento aún no es navegable');
  assert.match(r.body, /<button type="button" class="boton" data-copiar>Copiar como texto<\/button>/);
  assert.match(r.body, /data-captura>Modo captura</);
  assert.match(r.body, /<textarea id="texto-whatsapp" class="texto-wa" readonly rows="10">/);
  assert.match(r.body, /Participación a las 12:00 — PROVISIONAL \(2\/6 mesas\)/);
  assert.match(r.body, /4-2-A: 250 \(\+150\) · 40,7 %/);
  assert.match(r.body, /Actualizado: 20\/10\/2026 12:34:56 \(hora de Madrid\)/);
  assert.match(r.body, /<p id="estado-copia"/);
  assert.match(r.body, /class="aviso-sin-conexion"[^>]*>SIN CONEXIÓN · los datos son de las 12:34:56/);
});

test('la franja «SIN CONEXIÓN» está arriba del lienzo, antes de la tabla, para que salga en cualquier captura', async () => {
  const e = await entorno();
  e.rellenar(DATOS);
  for (const v of ['participacion', 'ultimo']) {
    const { body } = await pantallazo(e, v);
    const franja = body.indexOf('class="aviso-sin-conexion"');
    assert.ok(franja > 0, v);
    assert.ok(franja < body.indexOf('<table'), `la franja debe ir antes de la tabla (${v})`);
    assert.ok(franja > body.indexOf('id="lienzo"') && franja < body.indexOf('class="controles"'), 'dentro del lienzo');
  }
});

test('el cliente se sirve como recurso propio y contempla sondeo, copia, modo captura y fallo de conexión', async () => {
  const e = await entorno();
  const js = await get(e.app, '/resumen.js');
  assert.equal(js.statusCode, 200);
  assert.match(js.headers['content-type'], /javascript/);
  for (const parte of ['setInterval', 'navigator.clipboard', "classList.add('captura')", "classList.add('sin-conexion')", 'visibilitychange', "reemplazar(nuevo, '#banner-modo')"]) {
    assert.ok(js.body.includes(parte), parte);
  }
  const pagina = await pantallazo(e);
  assert.ok(!/<script(?![^>]*src=)/.test(pagina.body), 'sin scripts en línea (CSP)');
});

// ---------------- Histórico ----------------

test('histórico: lista la auditoría con hora de Madrid, filtra por mesa, actor y acción, y pagina', async () => {
  const e = await entorno();
  const agente = crearAgente(e.db, { nombre: 'María López', mesas: ['4-2-A'] });
  const s = await loginAgente(e.app, agente.pin);
  const mesaA = e.mesa('4-2-A');
  await post(e.app, `/agente/mesa/${mesaA}/guardar`, { _csrf: s.csrf, corte: e.corte('10:00'), votantes: '100' }, undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `sid_agente=${s.cookie}` } });
  await post_(e, `/admin/participacion/${e.mesa('4-2-B')}/${e.corte('10:00')}`, { votantes: '80' });
  await post_(e, `/admin/mesas/${mesaA}`, { distrito: '4', seccion: '2', letra: 'A', censo: '640' });

  const todo = await get(e.app, '/admin/historico', e.cookie);
  assert.equal(todo.statusCode, 200);
  assert.match(todo.body, /Mesa 4-2-A, corte 10:00: \(vacío\) → 100 \(introducido por agente\)/);
  assert.match(todo.body, /Mesa 4-2-B, corte 10:00: \(vacío\) → 80 \(introducido por administrador\)/);
  assert.match(todo.body, /Mesa 4-2-A: censo 615 → 640/);
  assert.match(todo.body, /Agente María López/);
  assert.match(todo.body, /Administrador admin/);
  assert.ok(todo.body.includes(BANNER));
  assert.match(todo.body, /codigo: 4-2-B, censo: 623/, 'la carga inicial se lee como texto, no como JSON');
  assert.ok(!/\{&quot;|\{"/.test(todo.body), 'sin JSON crudo en pantalla');

  const porActor = await get(e.app, '/admin/historico?actor=agente', e.cookie);
  assert.match(porActor.body, /Agente María López/);
  assert.ok(!/Administrador admin/.test(porActor.body));
  const porAccion = await get(e.app, '/admin/historico?accion=crear', e.cookie);
  assert.match(porAccion.body, /Crear/);
  assert.ok(!/Inicio de sesión/.test(porAccion.body.replace(/<option[^>]*>[^<]*<\/option>/g, '')));
  const porMesa = await get(e.app, `/admin/historico?mesa=${e.mesa('4-2-B')}`, e.cookie);
  assert.match(porMesa.body, /Mesa 4-2-B, corte 10:00/);
  assert.ok(!/Mesa 4-2-A, corte 10:00/.test(porMesa.body));
  const mesaYActor = await get(e.app, `/admin/historico?mesa=${mesaA}&actor=admin`, e.cookie);
  assert.match(mesaYActor.body, /censo 615 → 640/);
  assert.ok(!/Mesa 4-2-A, corte 10:00/.test(mesaYActor.body), 'ese dato lo metió un agente');
  assert.match((await get(e.app, '/admin/historico?actor=sistema', e.cookie)).body, /Carga inicial|Sistema/);
});

test('histórico: paginación con enlaces que conservan los filtros', async () => {
  const e = await entorno();
  const ins = e.db.prepare("INSERT INTO auditoria (fecha, actor_tipo, actor_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES (?, 'admin', 1, 'editar', 'mesa', 1, NULL, ?)");
  for (let i = 0; i < 60; i++) ins.run(`2026-10-01T10:00:${String(i).padStart(2, '0')}.000Z`, JSON.stringify({ n: i }));
  const p1 = await get(e.app, '/admin/historico?actor=admin&accion=editar', e.cookie);
  assert.match(p1.body, /Página 1 de 3/);
  assert.equal((p1.body.match(/<article class="entrada/g) ?? []).length, 25);
  assert.match(p1.body, /href="\/admin\/historico\?actor=admin&amp;accion=editar&amp;pagina=2">Siguiente »/);
  assert.ok(!p1.body.includes('« Anterior'));
  const p3 = await get(e.app, '/admin/historico?actor=admin&accion=editar&pagina=3', e.cookie);
  assert.match(p3.body, /Página 3 de 3/);
  assert.match(p3.body, /« Anterior/);
  assert.ok(!p3.body.includes('Siguiente »'));
  const fuera = await get(e.app, '/admin/historico?actor=admin&accion=editar&pagina=99', e.cookie);
  assert.match(fuera.body, /Página 3 de 3/, 'una página fuera de rango se ajusta');
  assert.notEqual(p1.body.match(/<time>[^<]*<\/time>/)[0], p3.body.match(/<time>[^<]*<\/time>/)[0]);
});

test('histórico: fecha en hora de Madrid, filtros inválidos ignorados y vacío con mensaje', async () => {
  const e = await entorno();
  e.db.prepare("INSERT INTO auditoria (fecha, actor_tipo, actor_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES ('2026-10-20T10:00:00.000Z', 'admin', 1, 'prueba', 'mesa', 1, NULL, '{\"a\":1}')").run();
  const r = await get(e.app, '/admin/historico?accion=prueba', e.cookie);
  assert.match(r.body, /<time>20\/10\/2026 12:00:00<\/time>/);
  for (const q of ['mesa=abc', 'actor=hacker', "accion='; DROP TABLE auditoria;--", 'pagina=-4', 'pagina=x']) {
    assert.equal((await get(e.app, `/admin/historico?${q}`, e.cookie)).statusCode, 200, q);
  }
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n > 0, true, 'la tabla sigue existiendo');
  assert.match((await get(e.app, '/admin/historico?accion=inexistente', e.cookie)).body, /No hay registros con estos filtros/);
});

test('histórico: NUNCA muestra PIN ni contraseñas (ni los generados ni los que alguien escribiera en la auditoría)', async () => {
  const e = await entorno();
  const agente = crearAgente(e.db, { nombre: 'Luis', mesas: [] });
  const gen = await post_(e, `/admin/agentes/${agente.id}/pin`, {});
  const pin = /class="pin"[^>]*>(\d{6})</.exec(gen.body)[1];
  await post_(e, '/admin/password', { actual: CONFIG.adminPasswordInitial, nueva: 'nueva-contraseña-secreta', repetir: 'nueva-contraseña-secreta' });
  e.db.prepare("INSERT INTO auditoria (fecha, actor_tipo, actor_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES ('2026-10-20T10:00:00.000Z', 'admin', 1, 'trampa', 'agente', 1, '{\"pin\":\"987654\",\"password_hash\":\"$argon2id$secreto\"}', '{\"pin_hmac\":\"abcdef\",\"tiene_pin\":true,\"anidado\":{\"token\":\"tok123\"}}')").run();

  const r = await get(e.app, '/admin/historico', e.cookie);
  assert.match(r.body, /Regenerar PIN/, 'el agente ya tenía PIN: se regenera');
  assert.match(r.body, /Cambiar contraseña/);
  for (const secreto of [pin, '987654', 'argon2id', 'secreto', 'abcdef', 'tok123', 'nueva-contraseña-secreta']) {
    assert.ok(!r.body.includes(secreto), `no debe aparecer ${secreto}`);
  }
  assert.match(r.body, /\[oculto\]/);
  assert.match(r.body, /tiene_pin/);
});

test('histórico en DEMO: configuración + captura de demo (etiquetada); la captura real no se muestra. En REAL, la real', async () => {
  const e = await entorno();
  const ins = (accion, valorNuevo) => e.db.prepare("INSERT INTO auditoria (fecha, actor_tipo, actor_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo) VALUES ('2026-10-19T10:00:00.000Z', 'agente', 1, ?, 'participacion', 1, NULL, ?)").run(accion, valorNuevo);
  ins('crear', JSON.stringify({ mesa_id: e.mesa('4-2-A'), corte_id: e.corte('10:00'), votantes_acumulados: 777, introducido_por_tipo: 'agente' }));
  e.rellenar({ '4-2-B': { '10:00': 111 } });

  const demo = await get(e.app, '/admin/historico', e.cookie);
  assert.match(demo.body, /Mesa 4-2-B, corte 10:00: \(vacío\) → 111/);
  assert.match(demo.body, /<span class="etiqueta-demo">DEMO<\/span>/);
  assert.ok(!demo.body.includes('777'), 'la captura real no se enseña en DEMO');
  assert.match(demo.body, /configuración y captura de la DEMO/);
  assert.ok(demo.body.includes(BANNER));

  e.reloj.fijar(REAL_12H34);
  const real = await get(e.app, '/admin/historico', e.cookie);
  assert.match(real.body, /Mesa 4-2-A, corte 10:00: \(vacío\) → 777/);
  assert.ok(!real.body.includes('111'));
  assert.ok(!real.body.includes('etiqueta-demo'));
  assert.ok(!existsSync(path.join(e.dataDir, 'demo.db')));
});

// ---------------- Cortes ----------------

const horasActuales = (db) => db.prepare('SELECT hora FROM corte ORDER BY orden').all().map((c) => c.hora);
const idsCortes = (db) => db.prepare('SELECT id FROM corte ORDER BY orden').all().map((c) => c.id);
const enviarHoras = (e, horas, extra = {}) => post_(e, '/admin/cortes', { ...Object.fromEntries(idsCortes(e.db).map((id, i) => [`hora_${id}`, horas[i]])), ...extra });
const BASE = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

test('cortes: formulario con las horas actuales y banner', async () => {
  const e = await entorno();
  const r = await get(e.app, '/admin/cortes', e.cookie);
  assert.equal(r.statusCode, 200);
  assert.equal((r.body.match(/type="time"/g) ?? []).length, 6);
  for (const hora of BASE) assert.match(r.body, new RegExp(`type="time" required value="${hora}"`));
  assert.ok(r.body.includes(BANNER));
});

test('cortes: cambiar una hora sin datos la guarda, la audita en app.db y la usa el corte actual del agente', async () => {
  const e = await entorno();
  const nuevas = ['09:30', ...BASE.slice(1)];
  const r = await enviarHoras(e, nuevas);
  assert.equal(r.statusCode, 302);
  assert.match(r.headers.location, /ok=cortes_guardados/);
  assert.deepEqual(horasActuales(e.db), nuevas);
  const fila = auditoria(e.db, 'editar').find((a) => a.entidad === 'corte');
  assert.equal(fila.actor_tipo, 'admin');
  assert.deepEqual([JSON.parse(fila.valor_anterior), JSON.parse(fila.valor_nuevo)], [{ hora: '10:00' }, { hora: '09:30' }]);
  assert.equal(auditoria(e.db, 'editar').filter((a) => a.entidad === 'corte').length, 1, 'solo el corte cambiado');

  // El agente ve la hora nueva: a las 09:45 (Madrid) el corte actual ya es el de las 09:30
  const agente = crearAgente(e.db);
  const s = await loginAgente(e.app, agente.pin);
  e.reloj.fijar('2026-10-20T07:45:00Z');
  const p = await getAgente(e.app, `/agente/mesa/${e.mesa('4-2-A')}`, s.cookie);
  assert.match(p.body, /Corte de las 09:30 \(actual\)/);
});

test('cortes: se pueden desplazar horas que coinciden con otras (la restricción de unicidad no estorba)', async () => {
  const e = await entorno();
  const nuevas = ['12:00', '13:00', '14:00', '16:00', '18:00', '20:00']; // la 1.ª pasa a ser la antigua 2.ª
  const r = await enviarHoras(e, nuevas);
  assert.equal(r.statusCode, 302);
  assert.deepEqual(horasActuales(e.db), nuevas);
  assert.equal(auditoria(e.db, 'editar').filter((a) => a.entidad === 'corte').length, 2);
});

test('cortes: validación de formato y de orden creciente; nada cambia y se conserva lo escrito', async () => {
  const e = await entorno();
  const malos = [
    [['abc', ...BASE.slice(1)], /no es una hora válida/],
    [['25:00', ...BASE.slice(1)], /no es una hora válida/],
    [['10:60', ...BASE.slice(1)], /no es una hora válida/],
    [['9:5', ...BASE.slice(1)], /no es una hora válida/],
    [['', ...BASE.slice(1)], /no es una hora válida/],
    [['10:00', '10:00', '14:00', '16:00', '18:00', '20:00'], /orden creciente.*10:00 \(corte 2\) no es posterior a 10:00/],
    [['10:00', '09:00', '14:00', '16:00', '18:00', '20:00'], /orden creciente/],
    [['10:00', '12:00', '14:00', '16:00', '18:00', '15:00'], /orden creciente/],
  ];
  for (const [horas, patron] of malos) {
    const r = await enviarHoras(e, horas);
    assert.equal(r.statusCode, 422, horas.join());
    assert.match(r.body, patron, horas.join());
  }
  assert.deepEqual(horasActuales(e.db), BASE);
  assert.equal(auditoria(e.db, 'editar').filter((a) => a.entidad === 'corte').length, 0);
  const conservado = await enviarHoras(e, ['10:00', '12:00', '14:00', '16:00', '18:00', '15:00']);
  assert.match(conservado.body, /type="time" required value="15:00"/);
});

test('cortes: sin cambios no hace nada; exige CSRF', async () => {
  const e = await entorno();
  const igual = await enviarHoras(e, BASE);
  assert.equal(igual.statusCode, 302);
  assert.match(igual.headers.location, /ok=cortes_sin_cambios/);
  assert.equal(auditoria(e.db, 'editar').filter((a) => a.entidad === 'corte').length, 0);
  const sinCsrf = await post(e.app, '/admin/cortes', { [`hora_${idsCortes(e.db)[0]}`]: '09:00' }, e.cookie);
  assert.equal(sinCsrf.statusCode, 403);
  assert.deepEqual(horasActuales(e.db), BASE);
});

test('cortes: si el corte ya tiene datos (de demo) avisa antes y solo cambia al confirmar; los demás cortes no piden aviso', async () => {
  const e = await entorno();
  e.rellenar({ '4-2-A': { '16:00': 100 }, '4-2-B': { '16:00': 90 } });
  const nuevas = [...BASE.slice(0, 3), '16:30', ...BASE.slice(4)];

  const aviso = await enviarHoras(e, nuevas);
  assert.equal(aviso.statusCode, 200);
  assert.match(aviso.body, /Hay datos en estos cortes/);
  assert.match(aviso.body, /El corte de las <strong>16:00<\/strong> pasará a las <strong>16:30<\/strong> y ya tiene 0 datos reales y 2 de demo/);
  assert.match(aviso.body, /name="confirmar" value="1"/);
  assert.deepEqual(horasActuales(e.db), BASE, 'no se cambia sin confirmar');

  const hecho = await enviarHoras(e, nuevas, { confirmar: '1' });
  assert.equal(hecho.statusCode, 302);
  assert.deepEqual(horasActuales(e.db), nuevas);
  // Los datos siguen asociados al mismo corte (solo cambia su hora)
  assert.equal(e.app.datos.captura().listarParticipacion().length, 2);

  // Cambiar otro corte, sin datos, no avisa aunque haya datos en otros
  const sinAviso = await enviarHoras(e, ['09:00', ...nuevas.slice(1)]);
  assert.equal(sinAviso.statusCode, 302);
});

test('cortes: el aviso cuenta también los datos REALES aunque se esté en DEMO (la hora es configuración compartida)', async () => {
  const e = await entorno();
  e.db.prepare("INSERT INTO participacion (mesa_id, corte_id, votantes_acumulados, introducido_por_tipo, introducido_por_id, actualizado_en) VALUES (?, ?, 50, 'agente', 1, 'x')").run(e.mesa('4-2-A'), e.corte('12:00'));
  assert.equal((await get(e.app, '/admin/cortes', e.cookie)).body.includes('Ya tiene datos: 1 reales · 0 de demo.'), true);
  const r = await enviarHoras(e, ['10:00', '12:15', ...BASE.slice(2)]);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /ya tiene 1 datos reales y 0 de demo/);
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 1, 'la lectura de lo real no modifica nada');
});
