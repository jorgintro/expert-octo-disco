import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { abrirDb, migrarApp } from '../src/db.js';
import { LIMITES, estaBloqueada, registrarFallo } from '../src/limiteIntentos.js';
import { vaciarDato } from '../src/servicioParticipacion.js';
import { raiz } from '../src/version.js';
import {
  CONFIG, cookieDe, crearAgente, crearDirectorioTemporal, crearEntorno, crearReloj, get, getAgente, intentarLogin,
  intentarPin, loginAdmin, loginAgente, post, postAgente,
} from './ayuda.js';

const BANNER = 'MODO DEMO - datos de prueba';
const HORA_16_30 = '2026-10-20T14:30:00Z'; // 16:30 en Madrid (CEST): corte actual = 16:00
const DIA_11H = '2026-11-29T10:00:00Z'; // 11:00 en Madrid (CET), ya en REAL: corte actual = 10:00

async function montar({ iso = HORA_16_30, mesas = ['4-2-A'], nombre = 'Ana' } = {}) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const agente = crearAgente(e.db, { nombre, mesas });
  const sesion = await loginAgente(e.app, agente.pin);
  const id = (codigo) => e.db.prepare('SELECT id FROM mesa WHERE codigo = ?').get(codigo).id;
  const corte = (hora) => e.db.prepare('SELECT id FROM corte WHERE hora = ?').get(hora).id;
  return { ...e, agente, ...sesion, mesaId: id, corteId: corte };
}
// guardar(e, mesa, votantes, extra): por defecto el corte de las 16:00; extra.corte lo cambia.
const guardar = (e, mesa, votantes, extra = {}, cookie = e.cookie, csrf = e.csrf) =>
  postAgente(e.app, `/agente/mesa/${e.mesaId(mesa)}/guardar`, { _csrf: csrf, corte: e.corteId('16:00'), votantes, ...extra }, cookie);
// ¿Sigue válida esta cookie de agente? (200 en su mesa; 302 a la entrada si no)
const valida = async (e, cookie, mesa = '4-2-A') => (await getAgente(e.app, `/agente/mesa/${e.mesaId(mesa)}`, cookie)).statusCode === 200;
const abrirDemo = (e) => new Database(path.join(e.dataDir, 'demo.db'), { readonly: true });
const filasDemo = (e) => { const d = abrirDemo(e); const f = d.prepare('SELECT * FROM participacion').all(); d.close(); return f; };
const auditoriaDemo = (e) => { const d = abrirDemo(e); const f = d.prepare('SELECT * FROM auditoria ORDER BY id').all(); d.close(); return f; };

// ---------------- Entrada por PIN ----------------

test('la raíz es la pantalla de PIN (teclado numérico) con enlace discreto al administrador', async () => {
  const { app } = await crearEntorno();
  const r = await get(app, '/');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /name="pin"[^>]*inputmode="numeric"/);
  assert.match(r.body, /maxlength="6"/);
  assert.match(r.body, /href="\/admin\/login"/);
  assert.ok(r.body.includes(BANNER));
});

test('PIN correcto: sesión de 14 h con cookie HttpOnly/Secure/SameSite=Lax y auditoría; PIN incorrecto: 401', async () => {
  const e = await crearEntorno();
  const { id, pin } = crearAgente(e.db);
  const mal = await intentarPin(e.app, pin === '123456' ? '654321' : '123456');
  assert.equal(mal.statusCode, 401);
  assert.match(mal.body, /PIN incorrecto/);
  assert.equal(cookieDe(mal), undefined);

  const ok = await intentarPin(e.app, pin);
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.headers.location, '/agente');
  const c = ok.cookies.find((x) => x.name === 'sid_agente');
  assert.deepEqual([c.httpOnly, c.secure, c.sameSite, c.maxAge], [true, true, 'Lax', 14 * 3600]);
  const fila = e.db.prepare("SELECT * FROM auditoria WHERE accion = 'login' AND actor_tipo = 'agente'").get();
  assert.equal(fila.actor_id, id);
  assert.ok(!JSON.stringify(e.db.prepare('SELECT * FROM auditoria').all()).includes(pin), 'el PIN no se audita');
});

test('un PIN mal formado se rechaza sin contar como intento fallido', async () => {
  const e = await crearEntorno();
  for (const malo of ['12345', '1234567', 'abcdef', '12 34']) {
    assert.equal((await intentarPin(e.app, malo)).statusCode, 422, malo);
  }
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM bloqueo_ip WHERE ambito = 'pin'").get().n, 0);
});

test('el PIN exige el token CSRF y su cookie', async () => {
  const e = await crearEntorno();
  const { pin } = crearAgente(e.db);
  const r = await e.app.inject({
    method: 'POST', url: '/entrar', payload: `pin=${pin}`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(r.statusCode, 403);
  assert.equal(cookieDe(r), undefined);
  assert.equal(e.db.prepare("SELECT COUNT(*) n FROM bloqueo_ip WHERE ambito = 'pin'").get().n, 0, 'no cuenta como intento');
});

test('límite del PIN: 15 fallos bloquean la IP; un acierto no reinicia el contador; el administrador no se ve afectado', async () => {
  const e = await crearEntorno();
  const { pin } = crearAgente(e.db, { pin: '111111' });
  const ip = { remoteAddress: '10.20.30.40' };
  const fallo = (i) => intentarPin(e.app, String(222222 + i), ip);

  for (let i = 0; i < LIMITES.pin.max - 1; i++) assert.equal((await fallo(i)).statusCode, 401);
  // Un agente acierta con 14 fallos acumulados en esa IP: entra, pero el contador NO se reinicia
  assert.equal((await intentarPin(e.app, pin, ip)).statusCode, 302);
  assert.equal((await fallo(99)).statusCode, 401, 'el 15.º fallo');
  const bloqueada = await intentarPin(e.app, pin, ip);
  assert.equal(bloqueada.statusCode, 429, 'ya ni el PIN correcto entra desde esa IP');
  assert.equal(cookieDe(bloqueada), undefined);
  assert.equal(estaBloqueada(e.db, 'pin', '10.20.30.40'), true);
  assert.equal(estaBloqueada(e.db, 'admin', '10.20.30.40'), false);

  // La contraseña de administrador sigue funcionando desde esa misma IP
  assert.equal((await intentarLogin(e.app, { usuario: 'admin', contrasena: CONFIG.adminPasswordInitial }, ip)).statusCode, 302);
  // Otra IP, sin afectar
  assert.equal((await intentarPin(e.app, pin, { remoteAddress: '10.20.30.41' })).statusCode, 302);
});

test('los fallos del administrador no bloquean a los agentes de la misma IP', async () => {
  const e = await crearEntorno();
  const { pin } = crearAgente(e.db);
  const ip = { remoteAddress: '10.20.30.50' };
  for (let i = 0; i < LIMITES.admin.max; i++) await intentarLogin(e.app, { usuario: 'admin', contrasena: 'mala' }, ip);
  assert.equal(estaBloqueada(e.db, 'admin', '10.20.30.50'), true);
  assert.equal((await intentarPin(e.app, pin, ip)).statusCode, 302);
});

test('revocar o regenerar el PIN, o dar de baja al agente, invalida su sesión; un agente de baja no entra', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  assert.equal(await valida(e, e.cookie), true);

  await post(e.app, `/admin/agentes/${e.agente.id}/pin`, { _csrf: admin.csrf }, admin.cookie); // regenerar
  assert.equal(await valida(e, e.cookie), false, 'regenerar invalida la sesión');
  assert.equal((await intentarPin(e.app, e.agente.pin)).statusCode, 401, 'el PIN antiguo ya no vale');

  const nuevo = e.db.prepare('SELECT pin_hmac FROM agente WHERE id = ?').get(e.agente.id).pin_hmac;
  assert.ok(nuevo);
  const otra = crearAgente(e.db, { nombre: 'Luis', pin: '135790' });
  const s = await loginAgente(e.app, otra.pin);
  assert.equal(await valida(e, s.cookie), true);
  await post(e.app, `/admin/agentes/${otra.id}/pin/revocar`, { _csrf: admin.csrf }, admin.cookie);
  assert.equal(await valida(e, s.cookie), false, 'revocar invalida la sesión');

  const baja = crearAgente(e.db, { nombre: 'Eva', pin: '246810' });
  const sb = await loginAgente(e.app, baja.pin);
  assert.equal(await valida(e, sb.cookie), true);
  await post(e.app, `/admin/agentes/${baja.id}/estado`, { _csrf: admin.csrf }, admin.cookie);
  assert.equal(await valida(e, sb.cookie), false, 'la baja invalida la sesión');
  assert.equal((await intentarPin(e.app, baja.pin)).statusCode, 401);
});

test('salir cierra la sesión del agente', async () => {
  const e = await montar();
  assert.equal(await valida(e, e.cookie), true);
  assert.equal((await postAgente(e.app, '/agente/salir', { _csrf: e.csrf }, e.cookie)).statusCode, 302);
  assert.equal(await valida(e, e.cookie), false);
});

// ---------------- Permisos ----------------

test('un agente solo ve y edita sus mesas; con varias aparece el selector', async () => {
  const e = await montar({ mesas: ['4-2-A', '4-3-B'] });
  const lista = await getAgente(e.app, '/agente', e.cookie);
  assert.equal(lista.statusCode, 200, 'con varias mesas no redirige');
  assert.match(lista.body, /Mesa 4-2-A/);
  assert.match(lista.body, /Mesa 4-3-B/);
  assert.ok(!lista.body.includes('5-18-U'));
  const mesa = await getAgente(e.app, `/agente/mesa/${e.mesaId('4-3-B')}`, e.cookie);
  assert.match(mesa.body, /aria-label="Cambiar de mesa"/);
  assert.match(mesa.body, /Mesa 4-3-B/);
});

test('un agente con una sola mesa entra directo en ella', async () => {
  const e = await montar();
  const r = await getAgente(e.app, '/agente', e.cookie);
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, `/agente/mesa/${e.mesaId('4-2-A')}`);
});

test('un agente NO puede ver ni tocar una mesa que no es suya, ni una mesa de baja', async () => {
  const e = await montar({ mesas: ['4-2-A'] });
  const ajena = e.mesaId('5-18-U');
  assert.equal((await getAgente(e.app, `/agente/mesa/${ajena}`, e.cookie)).statusCode, 403);
  assert.equal((await getAgente(e.app, '/agente/mesa/9999', e.cookie)).statusCode, 403);
  assert.equal((await getAgente(e.app, '/agente/mesa/abc', e.cookie)).statusCode, 403);
  const r = await guardar(e, '5-18-U', '10');
  assert.equal(r.statusCode, 403);
  assert.equal(filasDemo(e).length, 0, 'no se escribió nada');
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 0);

  // Mesa propia pero de baja: tampoco
  e.db.prepare("UPDATE mesa SET activa = 0 WHERE codigo = '4-2-A'").run();
  assert.equal((await getAgente(e.app, `/agente/mesa/${e.mesaId('4-2-A')}`, e.cookie)).statusCode, 403);
  assert.equal((await guardar(e, '4-2-A', '10')).statusCode, 403);
});

test('las cookies de agente y de administrador no son intercambiables', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  // La cookie del administrador (sid) no abre la zona de agente
  const comoAgente = await e.app.inject({ method: 'GET', url: '/agente', headers: { cookie: `sid_agente=${admin.cookie}` } });
  assert.equal(comoAgente.statusCode, 302);
  assert.equal((await get(e.app, '/admin', admin.cookie)).statusCode, 200, 'y esa petición no destruye la sesión del administrador');
  // La del agente, enviada como sid, no abre la de administración
  for (const url of ['/admin', '/admin/participacion']) {
    assert.equal((await get(e.app, url, e.cookie)).statusCode, 403, url);
  }
  const intento = await post(e.app, `/admin/participacion/${e.mesaId('4-2-A')}/${e.corteId('10:00')}`, { _csrf: e.csrf, votantes: '5' }, e.cookie);
  assert.equal(intento.statusCode, 403);
  assert.equal(filasDemo(e).length, 0);
  // Pueden convivir: el administrador sigue con sesión
  assert.equal((await get(e.app, '/admin', admin.cookie)).statusCode, 200);
});

test('las operaciones del agente exigen CSRF', async () => {
  const e = await montar();
  const r = await postAgente(e.app, `/agente/mesa/${e.mesaId('4-2-A')}/guardar`, { corte: e.corteId('16:00'), votantes: '10' }, e.cookie);
  assert.equal(r.statusCode, 403);
  assert.equal((await guardar(e, '4-2-A', '10', {}, e.cookie, 'falso')).statusCode, 403);
  assert.equal((await postAgente(e.app, '/agente/salir', {}, e.cookie)).statusCode, 403);
  assert.equal(filasDemo(e).length, 0);
});

// ---------------- Vista del agente y corte actual ----------------

test('el corte actual se preselecciona por hora (y el primero antes de las 10:00); se puede elegir otro', async () => {
  const mesa = (e) => `/agente/mesa/${e.mesaId('4-2-A')}`;
  const e = await montar();
  let r = await getAgente(e.app, mesa(e), e.cookie);
  assert.match(r.body, /Corte de las 16:00 \(actual\)/);
  assert.match(r.body, /name="votantes"[^>]*inputmode="numeric"/);
  assert.match(r.body, /Censo de la mesa: <strong>615<\/strong>/);

  r = await getAgente(e.app, `${mesa(e)}?corte=${e.corteId('12:00')}`, e.cookie);
  assert.match(r.body, /Corte de las 12:00</);
  assert.ok(!r.body.includes('Corte de las 12:00 (actual)'));
  r = await getAgente(e.app, `${mesa(e)}?corte=9999`, e.cookie);
  assert.match(r.body, /Corte de las 16:00 \(actual\)/, 'corte inválido: cae en el actual');

  e.reloj.fijar('2026-10-20T06:30:00Z'); // 08:30 en Madrid: aún no ha llegado ningún corte
  assert.match((await getAgente(e.app, mesa(e), e.cookie)).body, /Corte de las 10:00 \(actual\)/);
  e.reloj.fijar('2026-10-20T20:00:00Z'); // 22:00
  assert.match((await getAgente(e.app, mesa(e), e.cookie)).body, /Corte de las 20:00 \(actual\)/);
});

test('guardar un dato válido: va a demo.db en DEMO, queda auditado y el histórico lo muestra con parcial y %', async () => {
  const e = await montar();
  assert.equal((await guardar(e, '4-2-A', '100', {}, e.cookie)).statusCode, 302);
  const antes = e.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n;
  const r = await guardar(e, '4-2-A', '300', { corte: e.corteId('18:00') });
  assert.equal(r.statusCode, 200, 'salto de 200 votantes (>25 % de 615): pide confirmación');
  assert.match(r.body, /Revisa antes de guardar/);
  assert.equal(filasDemo(e).length, 1, 'aún no se ha guardado');

  const ok = await guardar(e, '4-2-A', '300', { corte: e.corteId('18:00'), confirmar: '1' });
  assert.equal(ok.statusCode, 302);
  assert.match(ok.headers.location, /ok=dato_guardado/);

  const filas = filasDemo(e);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => [f.votantes_acumulados, f.introducido_por_tipo, f.introducido_por_id]), [[100, 'agente', e.agente.id], [300, 'agente', e.agente.id]]);
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 0, 'nada en app.db');
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n, antes, 'la auditoría de captura demo no va a app.db');
  const aud = auditoriaDemo(e);
  assert.equal(aud.length, 2);
  assert.equal(aud[1].actor_tipo, 'agente');
  assert.equal(JSON.parse(aud[1].valor_nuevo).votantes_acumulados, 300);

  const pagina = await getAgente(e.app, ok.headers.location, e.cookie);
  assert.match(pagina.body, /Dato guardado/);
  assert.match(pagina.body, /<td class="num">100<\/td><td class="num">100<\/td><td class="num">16,3 %<\/td>/);
  assert.match(pagina.body, /<td class="num">300<\/td><td class="num">200<\/td><td class="num">48,8 %<\/td>/);
});

test('el agente puede corregir su dato; cualquier agente de la mesa corrige el de otro; todo queda auditado', async () => {
  const e = await montar();
  const otro = crearAgente(e.db, { nombre: 'Luis', mesas: ['4-2-A'] });
  const sb = await loginAgente(e.app, otro.pin);

  assert.equal((await guardar(e, '4-2-A', '50')).statusCode, 302);
  assert.equal((await guardar(e, '4-2-A', '60')).statusCode, 302, 'corrección propia');
  assert.equal((await guardar(e, '4-2-A', '70', {}, sb.cookie, sb.csrf)).statusCode, 302, 'corrección por otro agente de la mesa');

  assert.equal(filasDemo(e).length, 1);
  assert.equal(filasDemo(e)[0].votantes_acumulados, 70);
  assert.equal(filasDemo(e)[0].introducido_por_id, otro.id);
  const aud = auditoriaDemo(e);
  assert.deepEqual(aud.map((a) => a.accion), ['crear', 'editar', 'editar']);
  assert.equal(JSON.parse(aud[2].valor_anterior).votantes_acumulados, 60);
  assert.equal(JSON.parse(aud[2].valor_nuevo).votantes_acumulados, 70);
  assert.equal(aud[2].actor_id, otro.id);
  assert.ok(aud[2].fecha.endsWith('Z'));

  // Reenviar el mismo dato (reintento tras un corte de conexión) es inocuo: sin cambios y sin auditoría
  const repetido = await guardar(e, '4-2-A', '70', {}, sb.cookie, sb.csrf);
  assert.match(repetido.headers.location, /ok=dato_sin_cambios/);
  assert.equal(auditoriaDemo(e).length, 3);
});

test('validaciones en servidor: censo, monotonía, formato; el valor escrito se conserva en el formulario', async () => {
  const e = await montar();
  await guardar(e, '4-2-A', '100', { corte: e.corteId('12:00') });
  await guardar(e, '4-2-A', '200', { corte: e.corteId('16:00') });
  const casos = [
    ['700', '14:00', /superar el censo de la mesa \(615\)/],
    ['99', '14:00', /menor que el acumulado de las 12:00 \(100\)/],
    ['201', '14:00', /mayor que el acumulado de las 16:00 \(200\)/],
    ['-5', '14:00', /solo cifras/],
    ['12,5', '14:00', /solo cifras/],
    ['abc', '14:00', /solo cifras/],
    ['', '14:00', /Escribe el número/],
  ];
  for (const [valor, hora, patron] of casos) {
    const r = await guardar(e, '4-2-A', valor, { corte: e.corteId(hora) });
    assert.equal(r.statusCode, 422, valor);
    assert.match(r.body, patron, valor);
    assert.match(r.body, new RegExp(`name="votantes"[^>]*value="${valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'conserva lo escrito');
  }
  assert.equal(filasDemo(e).length, 2, 'ningún dato incoherente llegó a guardarse');
  // Un error nunca se salta con confirmar=1
  assert.equal((await guardar(e, '4-2-A', '700', { corte: e.corteId('14:00'), confirmar: '1' })).statusCode, 422);
  assert.equal(filasDemo(e).length, 2);
  // El corte debe existir
  assert.equal((await guardar(e, '4-2-A', '150', { corte: '9999' })).statusCode, 403);
});

test('salto >25 % pide confirmación en dos pasos; justo el 25 % no', async () => {
  const e = await montar();
  assert.equal((await guardar(e, '4-2-A', '153')).statusCode, 302, '153 de 615 = 24,9 %: sin aviso');
  assert.equal((await guardar(e, '4-2-A', '306', { corte: e.corteId('18:00') })).statusCode, 302, 'salto de 153 (24,9 %): sin aviso');
  const r = await guardar(e, '4-2-A', '460', { corte: e.corteId('20:00') });
  assert.equal(r.statusCode, 200, 'salto de 154 > 25 % de 615 (153,75): pide confirmación');
  assert.match(r.body, /Salto de 154 votantes en este tramo: más del 25 % del censo \(615\)/);
  assert.match(r.body, /name="confirmar" value="1"/);
  assert.match(r.body, /Sí, guardar 460/);
  assert.match(r.body, /No, corregir/);
  assert.equal(filasDemo(e).length, 2, 'sin confirmar no se guarda');
});

test('corte aún no llegado: en REAL pide confirmación, en DEMO no', async () => {
  // DEMO a las 16:30: guardar las 20:00 (futuro) es directo
  const demo = await montar();
  assert.equal((await guardar(demo, '4-2-A', '10', { corte: demo.corteId('20:00') })).statusCode, 302);

  // REAL a las 11:00 del día de las elecciones
  const real = await montar({ iso: DIA_11H });
  assert.equal((await get(real.app, '/healthz')).json().modo, 'REAL');
  const futuro = await guardar(real, '4-2-A', '10', { corte: real.corteId('20:00') });
  assert.equal(futuro.statusCode, 200);
  assert.match(futuro.body, /aún no ha llegado \(ahora son las 11:00\)/);
  assert.equal(real.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 0);
  const confirmado = await guardar(real, '4-2-A', '10', { corte: real.corteId('20:00'), confirmar: '1' });
  assert.equal(confirmado.statusCode, 302);
  // Un corte ya llegado (10:00 a las 11:00) no pide nada
  assert.equal((await guardar(real, '4-2-A', '5', { corte: real.corteId('10:00') })).statusCode, 302);
});

// ---------------- Modo ----------------

test('en REAL el agente escribe en app.db y no existe demo.db; en DEMO, al revés; el banner acompaña', async () => {
  const real = await montar({ iso: DIA_11H });
  await guardar(real, '4-2-A', '30', { corte: real.corteId('10:00') });
  assert.equal(real.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 1);
  const aud = real.db.prepare("SELECT * FROM auditoria WHERE entidad = 'participacion'").all();
  assert.equal(aud.length, 1);
  assert.equal(aud[0].actor_tipo, 'agente');
  assert.ok(!existsSync(path.join(real.dataDir, 'demo.db')));
  const pagina = await getAgente(real.app, `/agente/mesa/${real.mesaId('4-2-A')}`, real.cookie);
  assert.ok(!pagina.body.includes(BANNER));
  assert.match(pagina.body, /Modo REAL/);

  const demo = await montar();
  await guardar(demo, '4-2-A', '30');
  assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 0);
  assert.equal(filasDemo(demo).length, 1);
  const p = await getAgente(demo.app, `/agente/mesa/${demo.mesaId('4-2-A')}`, demo.cookie);
  assert.ok(p.body.includes(BANNER));
  assert.ok((await getAgente(demo.app, '/agente', demo.cookie)).headers.location.startsWith('/agente/mesa/'));
});

test('lo capturado en DEMO desaparece al pasar a REAL y no contamina los datos reales', async () => {
  const e = await montar();
  await guardar(e, '4-2-A', '40');
  const admin = await loginAdmin(e.app);
  const r = await post(e.app, '/admin/modo/cambiar', { _csrf: admin.csrf, destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' }, admin.cookie);
  assert.equal(r.statusCode, 302);
  assert.ok(!existsSync(path.join(e.dataDir, 'demo.db')));
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM participacion').get().n, 0);
  const pagina = await getAgente(e.app, `/agente/mesa/${e.mesaId('4-2-A')}`, e.cookie);
  assert.match(pagina.body, /<tr class="vacia"><td><a[^>]*>16:00<\/a><\/td>/, 'la mesa aparece vacía');
});

// ---------------- Administrador ----------------

test('el administrador introduce un dato: queda como «introducido por administrador» y el agente no puede modificarlo', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  const mesa = e.mesaId('4-2-A');
  const url = `/admin/participacion/${mesa}/${e.corteId('16:00')}`;

  const tabla = await get(e.app, '/admin/participacion', admin.cookie);
  assert.equal(tabla.statusCode, 200);
  for (const codigo of ['4-2-A', '4-2-B', '4-3-A', '4-3-B', '5-18-U', '5-31-U']) assert.match(tabla.body, new RegExp(codigo));
  for (const hora of ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00']) assert.match(tabla.body, new RegExp(`<th class="num">${hora}</th>`));
  assert.ok(tabla.body.includes(BANNER));

  assert.equal((await get(e.app, url, admin.cookie)).statusCode, 200);
  const sinCsrf = await post(e.app, url, { votantes: '120' }, admin.cookie);
  assert.equal(sinCsrf.statusCode, 403);
  const ok = await post(e.app, url, { _csrf: admin.csrf, votantes: '120' }, admin.cookie);
  assert.equal(ok.statusCode, 302);
  const fila = filasDemo(e)[0];
  assert.deepEqual([fila.votantes_acumulados, fila.introducido_por_tipo, fila.introducido_por_id], [120, 'admin', 1]);
  assert.match((await get(e.app, '/admin/participacion', admin.cookie)).body, /class="marca-admin"/);
  assert.match((await get(e.app, url, admin.cookie)).body, /Introducido por el administrador/);

  // El agente de esa mesa: ve el dato bloqueado con un mensaje claro y no puede cambiarlo
  const vista = await getAgente(e.app, `/agente/mesa/${mesa}?corte=${e.corteId('16:00')}`, e.cookie);
  assert.match(vista.body, /lo introdujo el administrador y solo él puede modificarlo/);
  assert.ok(!/<form[^>]*class="formulario form-dato"/.test(vista.body), 'sin formulario para el agente');
  const bloqueado = await guardar(e, '4-2-A', '130');
  assert.equal(bloqueado.statusCode, 403);
  assert.match(bloqueado.body, /solo él puede modificarlo/);
  assert.equal(filasDemo(e)[0].votantes_acumulados, 120);
  assert.equal(auditoriaDemo(e).length, 1);

  // El administrador sí puede corregirlo
  assert.equal((await post(e.app, url, { _csrf: admin.csrf, votantes: '125' }, admin.cookie)).statusCode, 302);
  assert.equal(filasDemo(e)[0].votantes_acumulados, 125);
  assert.deepEqual(auditoriaDemo(e).map((a) => a.actor_tipo), ['admin', 'admin']);
});

test('si el administrador corrige el dato de un agente, pasa a ser del administrador (queda bloqueado para agentes)', async () => {
  const e = await montar();
  await guardar(e, '4-2-A', '80');
  const admin = await loginAdmin(e.app);
  await post(e.app, `/admin/participacion/${e.mesaId('4-2-A')}/${e.corteId('16:00')}`, { _csrf: admin.csrf, votantes: '90' }, admin.cookie);
  assert.equal(filasDemo(e)[0].introducido_por_tipo, 'admin');
  assert.equal((await guardar(e, '4-2-A', '95')).statusCode, 403);
  // Incluso el mismo valor con otro autor cambia la autoría (y se audita)
  await post(e.app, `/admin/participacion/${e.mesaId('4-2-A')}/${e.corteId('16:00')}`, { _csrf: admin.csrf, votantes: '90' }, admin.cookie);
  assert.equal(auditoriaDemo(e).length, 2, 'el mismo dato del mismo autor no se vuelve a auditar');
});

test('el administrador aplica las mismas validaciones y confirmaciones', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  const url = (hora) => `/admin/participacion/${e.mesaId('4-2-A')}/${e.corteId(hora)}`;
  const enviar = (hora, datos) => post(e.app, url(hora), { _csrf: admin.csrf, ...datos }, admin.cookie);
  assert.equal((await enviar('12:00', { votantes: '9999' })).statusCode, 422);
  assert.equal((await enviar('12:00', { votantes: 'x' })).statusCode, 422);
  const salto = await enviar('12:00', { votantes: '400' });
  assert.equal(salto.statusCode, 200);
  assert.match(salto.body, /Revisa antes de guardar/);
  assert.equal(filasDemo(e).length, 0);
  assert.equal((await enviar('12:00', { votantes: '400', confirmar: '1' })).statusCode, 302);
  assert.equal((await enviar('10:00', { votantes: '500' })).statusCode, 422, 'no puede superar el acumulado de las 12:00');
  assert.equal((await post(e.app, `/admin/participacion/9999/${e.corteId('12:00')}`, { _csrf: admin.csrf, votantes: '1' }, admin.cookie)).statusCode, 404);
});

test('solo el administrador vacía una celda: confirmación previa, auditoría y la celda vuelve a ser editable por el agente', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  const mesa = e.mesaId('4-2-A');
  const corte = e.corteId('16:00');
  await post(e.app, `/admin/participacion/${mesa}/${corte}`, { _csrf: admin.csrf, votantes: '120' }, admin.cookie);

  const pregunta = await get(e.app, `/admin/participacion/${mesa}/${corte}/vaciar`, admin.cookie);
  assert.match(pregunta.body, /¿Vaciar el dato <strong>120<\/strong>/);
  assert.equal(filasDemo(e).length, 1, 'mirar la confirmación no borra nada');
  assert.equal((await post(e.app, `/admin/participacion/${mesa}/${corte}/vaciar`, {}, admin.cookie)).statusCode, 403, 'exige CSRF');

  const vaciado = await post(e.app, `/admin/participacion/${mesa}/${corte}/vaciar`, { _csrf: admin.csrf }, admin.cookie);
  assert.equal(vaciado.statusCode, 302);
  assert.match(vaciado.headers.location, /ok=dato_vaciado/);
  assert.equal(filasDemo(e).length, 0);
  const aud = auditoriaDemo(e).at(-1);
  assert.equal(aud.accion, 'vaciar');
  assert.equal(aud.actor_tipo, 'admin');
  assert.equal(JSON.parse(aud.valor_anterior).votantes_acumulados, 120);
  assert.equal(aud.valor_nuevo, null);

  assert.equal((await get(e.app, `/admin/participacion/${mesa}/${corte}/vaciar`, admin.cookie)).statusCode, 404, 'ya no hay nada que vaciar');
  assert.equal((await guardar(e, '4-2-A', '60')).statusCode, 302, 'el agente ya puede rellenarla');

  // Los agentes no vacían: no hay ruta y el servicio lo rechaza
  assert.equal((await postAgente(e.app, `/agente/mesa/${mesa}/vaciar`, { _csrf: e.csrf, corte }, e.cookie)).statusCode, 404);
  assert.throws(
    () => vaciarDato({ db: e.db, captura: e.app.datos.captura(), actor: { tipo: 'agente', id: e.agente.id }, mesaId: mesa, corteId: corte }),
    /Solo el administrador/
  );
  assert.equal(filasDemo(e).length, 1);
});

test('la tabla del administrador marca las mesas de baja y muestra los datos', async () => {
  const e = await montar();
  const admin = await loginAdmin(e.app);
  await guardar(e, '4-2-A', '77', { corte: e.corteId('10:00') });
  e.db.prepare("UPDATE mesa SET activa = 0 WHERE codigo = '5-31-U'").run();
  const r = await get(e.app, '/admin/participacion', admin.cookie);
  assert.match(r.body, /5-31-U<br><span class="nota">de baja/);
  assert.match(r.body, />77</);
  assert.equal((await get(e.app, '/admin/participacion/9999/9999', admin.cookie)).statusCode, 404);
});

// ---------------- Cliente ----------------

test('el JavaScript del cliente se sirve como recurso propio (CSP) y las páginas de captura lo enlazan', async () => {
  const e = await montar();
  const js = await get(e.app, '/agente.js');
  assert.equal(js.statusCode, 200);
  assert.match(js.headers['content-type'], /javascript/);
  assert.match(js.body, /AbortController/);
  assert.match(js.headers['content-security-policy'], /script-src 'self'/);
  const pagina = await getAgente(e.app, `/agente/mesa/${e.mesaId('4-2-A')}`, e.cookie);
  assert.match(pagina.body, /<script src="\/agente\.js\?v=[\d.]+" defer><\/script>/);
  assert.ok(!/<script(?![^>]*src=)/.test(pagina.body), 'sin scripts en línea');
  assert.match(pagina.body, /id="estado-envio"[^>]*aria-live="polite"/);
});

test('el nombre del agente y los textos se escapan en el HTML', async () => {
  const e = await crearEntorno();
  const a = crearAgente(e.db, { nombre: '<img src=x onerror=alert(1)>' });
  const s = await loginAgente(e.app, a.pin);
  const mesa = e.db.prepare("SELECT id FROM mesa WHERE codigo = '4-2-A'").get().id;
  const r = await getAgente(e.app, `/agente/mesa/${mesa}`, s.cookie);
  assert.ok(!r.body.includes('<img src=x'));
  assert.match(r.body, /&lt;img src=x/);
});

// ---------------- scripts/desbloquear ----------------

function baseConBloqueos() {
  const dataDir = crearDirectorioTemporal();
  const db = abrirDb(path.join(dataDir, 'app.db'));
  migrarApp(db);
  for (let i = 0; i < LIMITES.admin.max; i++) registrarFallo(db, 'admin', '203.0.113.5');
  for (let i = 0; i < LIMITES.pin.max; i++) registrarFallo(db, 'pin', '203.0.113.5');
  for (let i = 0; i < LIMITES.pin.max; i++) registrarFallo(db, 'pin', '203.0.113.6');
  return { dataDir, db };
}
const ejecutarScript = (dataDir, ...args) =>
  execFileSync('node', [path.join(raiz, 'scripts', 'desbloquear.js'), ...args], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('scripts/desbloquear.js libera todas las IP (administrador y PIN) sin el panel y lo audita', () => {
  const { dataDir, db } = baseConBloqueos();
  assert.equal(estaBloqueada(db, 'admin', '203.0.113.5'), true);
  const salida = ejecutarScript(dataDir);
  assert.match(salida, /administrador\s+203\.0\.113\.5\s+bloqueada hasta/);
  assert.match(salida, /OK: 3 registro\(s\) de bloqueo eliminados/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bloqueo_ip').get().n, 0);
  const aud = db.prepare("SELECT * FROM auditoria WHERE accion = 'desbloquear_ip'").get();
  assert.equal(aud.actor_tipo, 'sistema');
  assert.equal(JSON.parse(aud.valor_nuevo).origen, 'script');
});

test('scripts/desbloquear.js admite una IP y/o un ámbito', () => {
  const { dataDir, db } = baseConBloqueos();
  ejecutarScript(dataDir, '203.0.113.5', '--ambito', 'pin');
  assert.equal(estaBloqueada(db, 'pin', '203.0.113.5'), false);
  assert.equal(estaBloqueada(db, 'admin', '203.0.113.5'), true, 'otro ámbito intacto');
  assert.equal(estaBloqueada(db, 'pin', '203.0.113.6'), true, 'otra IP intacta');
  ejecutarScript(dataDir, '--ambito', 'admin');
  assert.equal(estaBloqueada(db, 'admin', '203.0.113.5'), false);
  assert.equal(estaBloqueada(db, 'pin', '203.0.113.6'), true);
  ejecutarScript(dataDir, '203.0.113.6');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bloqueo_ip').get().n, 0);
  assert.match(ejecutarScript(dataDir), /No había bloqueos/);
});

test('scripts/desbloquear.js rechaza argumentos inválidos y no crea una base si no existe', () => {
  const { dataDir } = baseConBloqueos();
  for (const args of [['no-es-ip'], ['--ambito', 'otro'], ['--ambito']]) {
    assert.throws(() => ejecutarScript(dataDir, ...args), (err) => err.status === 2 && /ERROR/.test(err.stderr));
  }
  const vacio = crearDirectorioTemporal();
  assert.throws(() => ejecutarScript(vacio), (err) => err.status === 1 && /No existe la base de datos/.test(err.stderr));
  assert.ok(!existsSync(path.join(vacio, 'app.db')), 'no crea una base vacía');
});
