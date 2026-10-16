import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorTexto, hojaCandidaturas, listarCandidaturas, tipoDeImagen } from '../src/candidaturas.js';
import { fijarAbierto } from '../src/recuentoEstado.js';
import { crearSesion } from '../src/sesiones.js';
import {
  CANDIDATURAS_MADRID, CONFIG, JPEG_MIN, PNG_1X1, WEBP_MIN, crearAgente, crearEntorno, crearReloj, get, getAgente, insertarCandidaturas,
  loginAdmin, loginAgente, post,
} from './ayuda.js';

const BANNER = 'MODO DEMO - datos de prueba';
const REAL_ISO = '2026-11-29T11:34:56Z';

async function entorno(iso = '2026-10-20T10:34:56Z') {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  return { ...e, ...(await loginAdmin(e.app)) };
}
const enviar = (e, url, datos) => post(e.app, url, { _csrf: e.csrf, ...datos }, e.cookie);
const crear = (e, datos) => enviar(e, '/admin/candidaturas', datos);
const orden = (db) => listarCandidaturas(db).map((c) => c.siglas || c.nombre);
const auditoria = (db, accion) => db.prepare("SELECT * FROM auditoria WHERE entidad = 'candidatura' AND accion = ? ORDER BY id").all(accion);
const put = (e, url, cuerpo, tipo = 'image/png', cabeceras = {}) =>
  e.app.inject({ method: 'PUT', url, payload: cuerpo, headers: { 'content-type': tipo, cookie: `sid=${e.cookie}`, 'x-csrf-token': e.csrf, ...cabeceras } });

// ---------- Permisos ----------
test('las candidaturas exigen sesión de administrador; los logos, cualquier sesión; la hoja de colores es pública', async () => {
  const e = await entorno();
  const [id] = insertarCandidaturas(e.db, [CANDIDATURAS_MADRID[0]]);
  for (const url of ['/admin/candidaturas', '/admin/candidaturas/nueva', `/admin/candidaturas/${id}`, `/admin/candidaturas/${id}/borrar`]) {
    assert.equal((await get(e.app, url)).statusCode, 302, url);
  }
  assert.equal((await post(e.app, '/admin/candidaturas', { nombre: 'X' })).statusCode, 302);
  assert.equal((await e.app.inject({ method: 'PUT', url: `/admin/candidaturas/${id}/logo`, payload: PNG_1X1, headers: { 'content-type': 'image/png' } })).statusCode, 302);

  const agente = crearAgente(e.db);
  const comoSid = crearSesion(e.db, CONFIG.sessionSecret, 'agente', agente.id);
  for (const url of ['/admin/candidaturas', `/admin/candidaturas/${id}`]) assert.equal((await get(e.app, url, comoSid.token)).statusCode, 403, url);
  assert.equal((await post(e.app, '/admin/candidaturas', { _csrf: comoSid.csrf, nombre: 'Intruso' }, comoSid.token)).statusCode, 403);
  assert.equal(listarCandidaturas(e.db).length, 1);

  assert.equal((await get(e.app, '/candidaturas.css')).statusCode, 200);
  assert.equal((await get(e.app, `/logos/${id}`)).statusCode, 403, 'sin sesión no se ven los logos');
});

// ---------- Alta, orden y validación ----------
test('alta: las candidaturas quedan en el orden de la Junta Electoral Central y la acción se audita', async () => {
  const e = await entorno();
  for (const c of CANDIDATURAS_MADRID.slice(0, 5)) {
    const r = await crear(e, { nombre: c.nombre, siglas: c.siglas, color: c.color, destacada: '1', activa: '1' });
    assert.equal(r.statusCode, 302, c.nombre);
  }
  assert.deepEqual(orden(e.db), ['PP', 'PSOE', 'VOX', 'FA', 'PODEMOS']);
  assert.deepEqual(listarCandidaturas(e.db).map((c) => c.orden), [1, 2, 3, 4, 5]);
  const a = auditoria(e.db, 'crear');
  assert.equal(a.length, 5);
  assert.equal(a[0].actor_tipo, 'admin');
  assert.equal(JSON.parse(a[0].valor_nuevo).nombre, 'Partido Popular');
  const lista = await get(e.app, '/admin/candidaturas', e.cookie);
  assert.match(lista.body, /5 candidaturas · 5 activas · 5 destacadas/);
  assert.ok(lista.body.indexOf('>PP<') < lista.body.indexOf('>PSOE<') && lista.body.indexOf('>PSOE<') < lista.body.indexOf('>PODEMOS<'));
  assert.match(lista.body, /rel="stylesheet" href="\/candidaturas\.css\?v=[0-9a-f]{10}"/);
  assert.ok(lista.body.includes(BANNER));
});

test('alta en una posición desplaza a las demás y mantiene 1..n', async () => {
  const e = await entorno();
  insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1' }, { nombre: 'Dos', siglas: 'U2' }, { nombre: 'Tres', siglas: 'U3' }]);
  await crear(e, { nombre: 'Nueva', siglas: 'NV', color: '#112233', posicion: '2' });
  assert.deepEqual(orden(e.db), ['U1', 'NV', 'U2', 'U3']);
  assert.deepEqual(listarCandidaturas(e.db).map((c) => c.orden), [1, 2, 3, 4]);
  await crear(e, { nombre: 'Al final', siglas: 'FN', color: '#112233', posicion: '99' });
  assert.equal(orden(e.db).at(-1), 'FN');
});

test('validación: nombre obligatorio y único (sin distinguir mayúsculas), siglas, color y «Otros» no destacada', async () => {
  const e = await entorno();
  await crear(e, { nombre: 'Partido Popular', siglas: 'PP', color: '#1d84ce' });
  const casos = [
    [{ nombre: '', color: '#112233' }, /nombre es obligatorio/],
    [{ nombre: 'x'.repeat(81), color: '#112233' }, /80 caracteres/],
    [{ nombre: 'partido  popular', color: '#112233' }, /Ya existe una candidatura llamada/],
    [{ nombre: 'Otra', siglas: 'S'.repeat(17), color: '#112233' }, /16 caracteres/],
    [{ nombre: 'Otra', color: 'rojo' }, /hexadecimal/],
    [{ nombre: 'Otra', color: '#12345' }, /hexadecimal/],
    [{ nombre: 'Otros', destacada: '1', color: '#112233' }, /«Otros» no puede ser destacada/],
  ];
  for (const [datos, patron] of casos) {
    const r = await crear(e, datos);
    assert.equal(r.statusCode, 422, JSON.stringify(datos));
    assert.match(r.body, patron);
  }
  assert.equal(listarCandidaturas(e.db).length, 1, 'ninguna candidatura inválida se guardó');
  assert.equal((await crear(e, { nombre: 'Otros', color: '#112233' })).statusCode, 302, '«Otros» sin destacar es válido');
  const conservado = await crear(e, { nombre: 'Otra', siglas: 'OT', color: 'rojo' });
  assert.match(conservado.body, /name="nombre"[^>]*value="Otra"/, 'conserva lo escrito');
});

// ---------- Edición y orden ----------
test('editar nombre, siglas, color, destacada, activa y posición; mover arriba y abajo; todo auditado', async () => {
  const e = await entorno();
  const [a, b, c] = insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1' }, { nombre: 'Dos', siglas: 'U2' }, { nombre: 'Tres', siglas: 'U3' }]);
  const r = await enviar(e, `/admin/candidaturas/${b}`, { estructura: '1', nombre: 'Dos Renombrado', siglas: 'D2', color: '#ff0000', destacada: '1', activa: '1', posicion: '1' });
  assert.equal(r.statusCode, 302);
  assert.deepEqual(orden(e.db), ['D2', 'U1', 'U3']);
  const fila = listarCandidaturas(e.db)[0];
  assert.deepEqual([fila.nombre, fila.color, fila.destacada, fila.activa], ['Dos Renombrado', '#ff0000', 1, 1]);
  const cambios = auditoria(e.db, 'editar');
  assert.ok(cambios.some((x) => JSON.parse(x.valor_nuevo).color === '#ff0000'));
  assert.ok(cambios.some((x) => JSON.parse(x.valor_nuevo).orden === 1));

  await enviar(e, `/admin/candidaturas/${c}/mover`, { sentido: 'subir' });
  assert.deepEqual(orden(e.db), ['D2', 'U3', 'U1']);
  await enviar(e, `/admin/candidaturas/${c}/mover`, { sentido: 'bajar' });
  assert.deepEqual(orden(e.db), ['D2', 'U1', 'U3']);
  const antes = auditoria(e.db, 'editar').length;
  await enviar(e, `/admin/candidaturas/${a}/mover`, { sentido: 'subir' }); // ya es la 2.ª; sube a la 1.ª
  await enviar(e, `/admin/candidaturas/${a}/mover`, { sentido: 'subir' }); // ya es la 1.ª: no hace nada
  assert.deepEqual(orden(e.db), ['U1', 'D2', 'U3']);
  assert.equal(auditoria(e.db, 'editar').length, antes + 1, 'mover la primera hacia arriba no audita');
  assert.deepEqual(listarCandidaturas(e.db).map((x) => x.orden), [1, 2, 3]);
});

test('desmarcar «Activa» y «Destacada» en el formulario las desactiva de verdad (una casilla sin marcar no se envía)', async () => {
  const e = await entorno();
  const [id] = insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1', destacada: 1, activa: 1 }]);
  await enviar(e, `/admin/candidaturas/${id}`, { estructura: '1', nombre: 'Uno', siglas: 'U1', color: '#546e7a', posicion: '1' });
  const fila = listarCandidaturas(e.db)[0];
  assert.deepEqual([fila.activa, fila.destacada], [0, 0]);
  await enviar(e, `/admin/candidaturas/${id}`, { estructura: '1', nombre: 'Uno', siglas: 'U1', color: '#546e7a', posicion: '1', activa: '1' });
  assert.deepEqual([listarCandidaturas(e.db)[0].activa, listarCandidaturas(e.db)[0].destacada], [1, 0]);
  const lista = await get(e.app, '/admin/candidaturas', e.cookie);
  assert.ok(!lista.body.includes('Inactiva'));
});

test('la hoja de colores trae el color de cada candidatura y un texto con contraste', async () => {
  const e = await entorno();
  const ids = insertarCandidaturas(e.db, [{ nombre: 'Azul oscuro', siglas: 'AZ', color: '#0a2a66' }, { nombre: 'Amarillo', siglas: 'AM', color: '#ffeb3b' }]);
  const r = await get(e.app, '/candidaturas.css');
  assert.match(r.headers['content-type'], /text\/css/);
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.match(r.body, new RegExp(`\\.cand-${ids[0]}\\{--c:#0a2a66;--t:#ffffff\\}`));
  assert.match(r.body, new RegExp(`\\.cand-${ids[1]}\\{--c:#ffeb3b;--t:#000000\\}`));
  const condicional = await e.app.inject({ url: '/candidaturas.css', headers: { 'if-none-match': r.headers.etag } });
  assert.equal(condicional.statusCode, 304);
  const antes = hojaCandidaturas(e.db).url;
  await enviar(e, `/admin/candidaturas/${ids[0]}`, { nombre: 'Azul oscuro', siglas: 'AZ', color: '#123456' });
  assert.notEqual(hojaCandidaturas(e.db).url, antes, 'la URL de la hoja cambia con los colores (se versiona)');
  assert.equal(colorTexto('#ffffff'), '#000000');
  assert.equal(colorTexto('#000000'), '#ffffff');
});

// ---------- Bloqueo de la estructura ----------
test('con el recuento REAL activado: la estructura queda bloqueada (aunque se cierre) y solo se corrigen nombre, siglas, color y logo', async () => {
  const e = await entorno(REAL_ISO);
  const [a, b] = insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1', destacada: 1 }, { nombre: 'Dos', siglas: 'U2' }]);
  assert.equal((await get(e.app, '/admin/candidaturas', e.cookie)).body.includes('Añadir candidatura'), true);
  fijarAbierto(e.db, 'REAL', true);
  fijarAbierto(e.db, 'REAL', false); // se cierra: sigue bloqueada

  const lista = await get(e.app, '/admin/candidaturas', e.cookie);
  assert.match(lista.body, /Recuento activado: la estructura .* bloqueada/);
  assert.ok(!lista.body.includes('Añadir candidatura'));
  assert.equal((await get(e.app, '/admin/candidaturas/nueva', e.cookie)).statusCode, 409);
  assert.equal((await crear(e, { nombre: 'Nueva', color: '#112233' })).statusCode, 409);
  assert.equal((await enviar(e, `/admin/candidaturas/${a}/mover`, { sentido: 'bajar' })).statusCode, 409);
  assert.equal((await enviar(e, `/admin/candidaturas/${b}/borrar`, {})).statusCode, 409);
  assert.equal((await get(e.app, `/admin/candidaturas/${b}/borrar`, e.cookie)).statusCode, 409);
  assert.deepEqual(orden(e.db), ['U1', 'U2']);

  // Editar: el formulario no envía la estructura; destacada/activa/posición no cambian aunque se intenten
  const ficha = await get(e.app, `/admin/candidaturas/${a}`, e.cookie);
  assert.match(ficha.body, /name="posicion"[^>]*disabled/);
  assert.ok(!ficha.body.includes('name="estructura"'));
  const cosmetica = await enviar(e, `/admin/candidaturas/${a}`, { nombre: 'Uno corregido', siglas: 'UNO', color: '#00ff00', destacada: '', activa: '' });
  assert.equal(cosmetica.statusCode, 302);
  const fila = listarCandidaturas(e.db)[0];
  assert.deepEqual([fila.nombre, fila.siglas, fila.color, fila.destacada, fila.activa, fila.orden], ['Uno corregido', 'UNO', '#00ff00', 1, 1, 1]);
  // Intentar cambiar la estructura enviando el campo oculto se rechaza
  const intento = await enviar(e, `/admin/candidaturas/${a}`, { estructura: '1', nombre: 'Uno corregido', siglas: 'UNO', color: '#00ff00', activa: '1', posicion: '2' });
  assert.equal(intento.statusCode, 409);
  assert.equal(listarCandidaturas(e.db)[0].orden, 1);
  const desactivar = await enviar(e, `/admin/candidaturas/${a}`, { estructura: '1', nombre: 'Uno corregido', siglas: 'UNO', color: '#00ff00', destacada: '1', posicion: '1' });
  assert.equal(desactivar.statusCode, 409, 'desactivar es estructura');
  assert.equal(listarCandidaturas(e.db)[0].activa, 1);
});

test('en DEMO el bloqueo es de la demo: se activa al abrir la demo y se levanta con «Reiniciar demo»; REAL no lo hereda', async () => {
  const e = await entorno();
  insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1' }]);
  fijarAbierto(e.db, 'DEMO', true);
  assert.equal((await crear(e, { nombre: 'Dos', color: '#112233' })).statusCode, 409);
  assert.match((await get(e.app, '/admin/candidaturas', e.cookie)).body, /Modo → Reiniciar demo/);
  await post(e.app, '/admin/modo/reiniciar-demo', { _csrf: e.csrf }, e.cookie);
  assert.equal((await crear(e, { nombre: 'Dos', color: '#112233' })).statusCode, 302, 'tras reiniciar la demo se puede editar la estructura');

  fijarAbierto(e.db, 'DEMO', true);
  await post(e.app, '/admin/modo/cambiar', { _csrf: e.csrf, destino: 'REAL', contrasena: CONFIG.adminPasswordInitial, palabra: 'REAL' }, e.cookie);
  assert.equal((await crear(e, { nombre: 'Tres', color: '#112233' })).statusCode, 302, 'en REAL no se hereda el bloqueo de la demo');
});

// ---------- Borrado ----------
test('borrar: con confirmación, solo sin votos (reales ni de demo), renumera y audita', async () => {
  const e = await entorno();
  const [a, b, c] = insertarCandidaturas(e.db, [{ nombre: 'Uno', siglas: 'U1' }, { nombre: 'Dos', siglas: 'U2' }, { nombre: 'Tres', siglas: 'U3' }]);
  const pregunta = await get(e.app, `/admin/candidaturas/${b}/borrar`, e.cookie);
  assert.match(pregunta.body, /¿Borrar la candidatura <strong>Dos<\/strong>\?/);
  assert.equal(listarCandidaturas(e.db).length, 3, 'mirar la confirmación no borra');

  // Votos de demo
  const mesa = e.db.prepare('SELECT id FROM mesa LIMIT 1').get().id;
  e.app.datos.sincronizar();
  e.app.datos.captura().guardarRecuento({ mesaId: mesa, valores: { votos: new Map([[a, 0]]) }, estado: 'borrador', versionEsperada: 0, actor: { tipo: 'admin', id: 1 } });
  const conVotosDemo = await enviar(e, `/admin/candidaturas/${a}/borrar`, {});
  assert.equal(conVotosDemo.statusCode, 409);
  assert.match(conVotosDemo.body, /ya tiene votos \(0 reales, 1 de demo\)/);
  // Votos reales
  e.db.prepare('INSERT INTO recuento_voto (mesa_id, candidatura_id, votos) VALUES (?, ?, 5)').run(mesa, c);
  assert.equal((await enviar(e, `/admin/candidaturas/${c}/borrar`, {})).statusCode, 409);
  assert.equal(listarCandidaturas(e.db).length, 3);

  const ok = await enviar(e, `/admin/candidaturas/${b}/borrar`, {});
  assert.equal(ok.statusCode, 302);
  assert.deepEqual(orden(e.db), ['U1', 'U3']);
  assert.deepEqual(listarCandidaturas(e.db).map((x) => x.orden), [1, 2]);
  const fila = auditoria(e.db, 'borrar')[0];
  assert.equal(JSON.parse(fila.valor_anterior).nombre, 'Dos');
});

// ---------- Logos ----------
test('logo: se sube en bruto (PNG, JPEG, WebP), se sirve con caché inmutable y ETag solo con sesión, y se audita sin guardar bytes en la auditoría', async () => {
  const e = await entorno();
  const [id] = insertarCandidaturas(e.db, [CANDIDATURAS_MADRID[0]]);
  for (const [tipo, cuerpo] of [['image/png', PNG_1X1], ['image/jpeg', JPEG_MIN], ['image/webp', WEBP_MIN]]) {
    const r = await put(e, `/admin/candidaturas/${id}/logo`, cuerpo, tipo);
    assert.equal(r.statusCode, 200, tipo);
    assert.equal(r.json().ok, true);
  }
  const fila = e.db.prepare('SELECT logo_tipo, logo_hash FROM candidatura WHERE id = ?').get(id);
  assert.equal(fila.logo_tipo, 'image/webp');
  const hash = fila.logo_hash;
  assert.match(hash, /^[0-9a-f]{12}$/);

  const img = await get(e.app, `/logos/${id}?v=${hash}`, e.cookie);
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/webp');
  assert.equal(img.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(img.headers['x-content-type-options'], 'nosniff');
  assert.equal(img.rawPayload.equals(WEBP_MIN), true);
  const cond = await e.app.inject({ url: `/logos/${id}`, headers: { cookie: `sid=${e.cookie}`, 'if-none-match': img.headers.etag } });
  assert.equal(cond.statusCode, 304);

  const agente = crearAgente(e.db);
  const s = await loginAgente(e.app, agente.pin);
  assert.equal((await getAgente(e.app, `/logos/${id}`, s.cookie)).statusCode, 200, 'un agente con sesión ve los logos');
  assert.equal((await get(e.app, `/logos/${id}`)).statusCode, 403);
  assert.equal((await get(e.app, '/logos/999', e.cookie)).statusCode, 404);

  const aud = auditoria(e.db, 'editar').map((a) => a.valor_nuevo).join('');
  assert.ok(aud.includes(hash));
  assert.ok(!aud.includes('RIFF'), 'los bytes del logo no van a la auditoría');
  const lista = await get(e.app, '/admin/candidaturas', e.cookie);
  assert.match(lista.body, new RegExp(`<img src="/logos/${id}\\?v=${hash}"`));
});

test('logo: se rechazan SVG, tipos falsos, tamaño excesivo, sin CSRF y los bytes que no son una imagen', async () => {
  const e = await entorno();
  const [id] = insertarCandidaturas(e.db, [CANDIDATURAS_MADRID[0]]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, svg, 'image/svg+xml')).statusCode, 415, 'SVG con su tipo');
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, svg, 'image/png')).statusCode, 415, 'SVG disfrazado de PNG');
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, Buffer.from('GIF89a....'), 'image/png')).statusCode, 415, 'GIF');
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, Buffer.alloc(0), 'image/png')).statusCode, 422);
  const grande = Buffer.concat([PNG_1X1, Buffer.alloc(310 * 1024)]);
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, grande, 'image/png')).statusCode, 413);
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, PNG_1X1, 'image/png', { 'x-csrf-token': 'falso' })).statusCode, 403);
  assert.equal((await put(e, '/admin/candidaturas/9999/logo', PNG_1X1)).statusCode, 404);
  assert.equal(e.db.prepare('SELECT logo FROM candidatura WHERE id = ?').get(id).logo, null, 'ningún logo inválido se guardó');
  assert.equal(tipoDeImagen(PNG_1X1), 'image/png');
  assert.equal(tipoDeImagen(svg), null);
});

test('logo: se puede cambiar y quitar aunque la estructura esté bloqueada; la ficha muestra la subida', async () => {
  const e = await entorno(REAL_ISO);
  const [id] = insertarCandidaturas(e.db, [CANDIDATURAS_MADRID[0]]);
  fijarAbierto(e.db, 'REAL', true);
  assert.equal((await put(e, `/admin/candidaturas/${id}/logo`, PNG_1X1)).statusCode, 200);
  const ficha = await get(e.app, `/admin/candidaturas/${id}`, e.cookie);
  assert.match(ficha.body, /class="archivo-logo" type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(ficha.body, /<script src="\/candidaturas\.js\?v=[\d.]+" defer>/);
  assert.equal((await enviar(e, `/admin/candidaturas/${id}/logo/quitar`, {})).statusCode, 302);
  assert.equal(e.db.prepare('SELECT logo FROM candidatura WHERE id = ?').get(id).logo, null);
  assert.equal((await get(e.app, `/logos/${id}`, e.cookie)).statusCode, 404);
  assert.ok((await get(e.app, '/candidaturas.js')).body.includes("method: 'PUT'"));
});
