import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fijarSenadoAbierto, fijarAbierto } from '../src/recuentoEstado.js';
import { listarCandidatos } from '../src/candidatosSenado.js';
import {
  CANDIDATURAS_MADRID, CONFIG, candidatosSenadoEjemplo, crearAgente, crearEntorno, crearReloj, get, getAgente, insertarCandidaturas,
  insertarCandidatosSenado, loginAdmin, loginAgente, post, postAgente,
} from './ayuda.js';
import { crearSesion } from '../src/sesiones.js';

const DEMO_ISO = '2026-10-20T10:00:00Z';
const REAL_21H = '2026-11-29T20:30:00Z';
const REAL_11H = '2026-11-29T10:00:00Z';

async function montar(iso = DEMO_ISO, { mesas = ['4-2-A'] } = {}) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const partidos = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(0, 2));
  const ids = insertarCandidatosSenado(e.db, candidatosSenadoEjemplo(partidos).slice(0, 6));
  e.app.datos.sincronizar();
  const agente = crearAgente(e.db, { nombre: 'Ana', mesas });
  const ag = await loginAgente(e.app, agente.pin);
  const ad = await loginAdmin(e.app);
  const mesa = (codigo) => e.db.prepare('SELECT id, censo FROM mesa WHERE codigo = ?').get(codigo);
  const modo = () => e.app.datos.estado.modo;
  const abrir = () => fijarSenadoAbierto(e.db, modo(), true);
  const sab = ({ blancas = 0, nulas = 0, votos = [], matriz = {}, version = 0, ...extra } = {}) => ({
    modo: 'sabana', version, blancas, nulas,
    ...Object.fromEntries(ids.map((id, i) => [`c_${id}`, votos[i] ?? 0])),
    ...Object.fromEntries(Object.entries({ '1_1': 0, '2_0': 0, '2_1': 0, '3_0': 0, '3_1': 0, ...matriz }).map(([k, v]) => [`m_${k}`, v])),
    ...extra,
  });
  const tot = ({ validas = '', blancas = '', nulas = '', votos = [], resto = '', version = 0, ...extra } = {}) => ({
    modo: 'totales', version, validas, blancas, nulas, ...Object.fromEntries(ids.map((id, i) => [`c_${id}`, votos[i] ?? resto])), ...extra,
  });
  const cab = (cod) => e.app.datos.captura().obtenerSenado(mesa(cod).id).cab;
  const cabs = { 'x-requested-with': 'fetch', 'content-type': 'application/x-www-form-urlencoded' };
  const agPost = (cod, accion, datos, fetchear = false) =>
    postAgente(e.app, `/agente/mesa/${mesa(cod).id}/senado/${accion}`, { _csrf: ag.csrf, ...datos }, ag.cookie, { headers: { cookie: `sid_agente=${ag.cookie}`, 'content-type': 'application/x-www-form-urlencoded', ...(fetchear ? { 'x-requested-with': 'fetch' } : {}) } });
  const adPost = (cod, accion, datos) => post(e.app, `/admin/senado/mesa/${mesa(cod).id}/${accion}`, { _csrf: ad.csrf, ...datos }, ad.cookie);
  const demo = () => new Database(path.join(e.dataDir, 'demo.db'), { readonly: true });
  return { ...e, partidos, ids, ag, ad, mesa, modo, abrir, sab, tot, cab, cabs, agPost, adPost, demo };
}
const TOT_OK = { validas: 10, blancas: 2, nulas: 1, votos: [4, 3, 5, 0, 0, 0] };

// ---------- Candidatos (administración) ----------
test('candidatos del Senado: exigen administrador; alta con partido hereda color y logo; orden, edición y baja lógica', async () => {
  const e = await montar();
  for (const url of ['/admin/senado', '/admin/senado/candidatos', '/admin/senado/candidatos/nuevo', `/admin/senado/mesa/${e.mesa('4-2-A').id}`]) {
    assert.equal((await get(e.app, url)).statusCode, 302, `anónimo → login: ${url}`);
    const sesionAgente = await e.app.inject({ method: 'GET', url, headers: { cookie: `sid=${e.ag.cookie}` } });
    assert.notEqual(sesionAgente.statusCode, 200, 'la cookie de agente no vale como admin');
  }
  const comoSid = crearSesion(e.db, CONFIG.sessionSecret, 'agente', 1);
  assert.equal((await post(e.app, '/admin/senado/candidatos', { _csrf: comoSid.csrf, nombre: 'Intruso' }, comoSid.token)).statusCode, 403);

  const antes = listarCandidatos(e.db).length;
  const r = await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: 'Nuevo Candidato', candidatura_id: e.partidos[1], estructura: '1', activo: '1', color: '#112233' }, e.ad.cookie);
  assert.equal(r.statusCode, 302);
  const nuevo = listarCandidatos(e.db).at(-1);
  assert.deepEqual([nuevo.nombre, nuevo.orden, nuevo.color_efectivo], ['Nuevo Candidato', antes + 1, CANDIDATURAS_MADRID[1].color], 'con partido, hereda el color del partido');
  const dup = await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: 'nuevo candidato', estructura: '1', activo: '1' }, e.ad.cookie);
  assert.equal(dup.statusCode, 422);
  assert.match(dup.body, /Ya existe un candidato/);
  const sinNombre = await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: ' ', estructura: '1' }, e.ad.cookie);
  assert.equal(sinNombre.statusCode, 422);
  const mal = await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: 'X', candidatura_id: '9999', estructura: '1' }, e.ad.cookie);
  assert.match(mal.body, /El partido elegido no existe/);

  const lista = await get(e.app, '/admin/senado/candidatos', e.ad.cookie);
  assert.equal(lista.statusCode, 200);
  assert.match(lista.body, /candidatos · \d+ activos · \d+ listas/);
  assert.match(lista.body, /\/logos\/|marca-insignia/);

  await post(e.app, `/admin/senado/candidatos/${nuevo.id}/mover`, { _csrf: e.ad.csrf, sentido: 'subir' }, e.ad.cookie);
  assert.equal(listarCandidatos(e.db).find((c) => c.id === nuevo.id).orden, antes);
  // Desmarcar «activo» desactiva (no se borra).
  await post(e.app, `/admin/senado/candidatos/${nuevo.id}`, { _csrf: e.ad.csrf, nombre: 'Nuevo Candidato', candidatura_id: e.partidos[1], estructura: '1', posicion: String(antes) }, e.ad.cookie);
  assert.equal(listarCandidatos(e.db).find((c) => c.id === nuevo.id).activo, 0);
  const hoja = await get(e.app, '/candidaturas.css');
  assert.match(hoja.body, new RegExp(`\\.cs-${nuevo.id}\\{--c:${CANDIDATURAS_MADRID[1].color}`));
});

test('con el Senado activado, la pantalla de candidatos bloquea alta, orden y activo (y las rutas lo rechazan)', async () => {
  const e = await montar();
  e.abrir();
  const lista = await get(e.app, '/admin/senado/candidatos', e.ad.cookie);
  assert.match(lista.body, /Recuento del Senado activado: la estructura/);
  assert.doesNotMatch(lista.body, /Añadir candidato/);
  const alta = await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: 'Tarde', estructura: '1' }, e.ad.cookie);
  assert.equal(alta.statusCode, 409);
  assert.equal(listarCandidatos(e.db).some((c) => c.nombre === 'Tarde'), false);
  const c = listarCandidatos(e.db)[0];
  const mover = await post(e.app, `/admin/senado/candidatos/${c.id}/mover`, { _csrf: e.ad.csrf, sentido: 'bajar' }, e.ad.cookie);
  assert.equal(mover.statusCode, 409);
  const editar = await post(e.app, `/admin/senado/candidatos/${c.id}`, { _csrf: e.ad.csrf, nombre: 'Ana Pérez Ruiz', candidatura_id: c.candidatura_id }, e.ad.cookie);
  assert.equal(editar.statusCode, 302, 'el nombre sigue editable');
  assert.equal(listarCandidatos(e.db)[0].nombre, 'Ana Pérez Ruiz');
  assert.equal(listarCandidatos(e.db)[0].activo, 1, 'activo se conserva con la estructura bloqueada');
});

// ---------- Apertura ----------
test('panel: abrir y cerrar el Senado con confirmación y auditoría; el Congreso no se toca', async () => {
  const e = await montar();
  const abre = await post(e.app, '/admin/senado/abrir', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.equal(abre.statusCode, 302);
  assert.match(abre.headers.location, /ok=senado_abierto/);
  assert.equal(e.db.prepare("SELECT valor FROM ajuste WHERE clave = 'senado_demo_abierto'").get().valor, '1');
  assert.notEqual(e.db.prepare("SELECT valor FROM ajuste WHERE clave = 'recuento_demo_abierto'").get()?.valor, '1', 'el Congreso sigue sin abrir');
  const cierre = await post(e.app, '/admin/senado/cerrar', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.match(cierre.body, /¿Cerrar el recuento del Senado\?/);
  assert.equal((await post(e.app, '/admin/senado/cerrar', { _csrf: e.ad.csrf, confirmar: '1' }, e.ad.cookie)).statusCode, 302);
  assert.deepEqual(e.db.prepare("SELECT accion FROM auditoria WHERE accion IN ('abrir_senado','cerrar_senado') ORDER BY id").all().map((f) => f.accion), ['abrir_senado', 'cerrar_senado']);
});

test('REAL antes de las 20:00: avisa y abre solo tras confirmar; a las 21:30 abre directo; REAL empieza cerrado', async () => {
  const e = await montar(REAL_11H);
  const panel = await get(e.app, '/admin/senado', e.ad.cookie);
  assert.match(panel.body, /CERRADO/);
  const aviso = await post(e.app, '/admin/senado/abrir', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.equal(aviso.statusCode, 200);
  assert.match(aviso.body, /los colegios cierran a las 20:00/);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM ajuste WHERE clave = 'senado_real_abierto' AND valor = '1'").get().n, 0);
  assert.equal((await post(e.app, '/admin/senado/abrir', { _csrf: e.ad.csrf, confirmar: '1' }, e.ad.cookie)).statusCode, 302);
  const tarde = await montar(REAL_21H);
  assert.equal((await post(tarde.app, '/admin/senado/abrir', { _csrf: tarde.ad.csrf }, tarde.ad.cookie)).statusCode, 302);
  const vacio = await crearEntorno({ reloj: crearReloj(DEMO_ISO) });
  const ad = await loginAdmin(vacio.app);
  const sin = await post(vacio.app, '/admin/senado/abrir', { _csrf: ad.csrf }, ad.cookie);
  assert.equal(sin.statusCode, 409);
  assert.match(sin.body, /No hay candidatos del Senado activos/);
});

// ---------- Agente ----------
test('Senado cerrado: el agente no ve el formulario ni la tarjeta, ni puede guardar', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true); // solo el Congreso abierto
  const m = e.mesa('4-2-A');
  const mesa = await getAgente(e.app, `/agente/mesa/${m.id}`, e.ag.cookie);
  assert.doesNotMatch(mesa.body, /Recuento del Senado/);
  const r = await getAgente(e.app, `/agente/mesa/${m.id}/senado`, e.ag.cookie);
  assert.equal(r.statusCode, 403);
  assert.doesNotMatch(r.body, /form-senado/);
  assert.equal((await e.agPost('4-2-A', 'guardar', e.tot({ validas: 5 }))).statusCode, 403);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 0);
});

test('Senado abierto: tarjeta en la mesa, pestañas Congreso | Senado y pantalla de papeleta con las listas', async () => {
  const e = await montar();
  e.abrir();
  fijarAbierto(e.db, 'DEMO', true);
  const m = e.mesa('4-2-A');
  const mesa = await getAgente(e.app, `/agente/mesa/${m.id}`, e.ag.cookie);
  assert.match(mesa.body, /Recuento del Senado/);
  const r = await getAgente(e.app, `/agente/mesa/${m.id}/senado`, e.ag.cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /class="pestanas"/);
  assert.match(r.body, /aria-current="page">Senado/);
  assert.match(r.body, /data-modo="sabana"/);
  for (const id of e.ids) assert.match(r.body, new RegExp(`data-candidato="${id}"`));
  assert.equal([...r.body.matchAll(/data-lista-completa=/g)].length, 2, 'una «Lista completa» por partido de 3 (PP y PSOE)');
  assert.match(r.body, /type="module" src="\/senado\.js\?v=/);
  assert.match(r.body, /Usar «Totales»/);
  const congreso = await getAgente(e.app, `/agente/mesa/${m.id}/recuento`, e.ag.cookie);
  assert.match(congreso.body, /aria-current="page">Congreso/);
  const totales = await getAgente(e.app, `/agente/mesa/${m.id}/senado?modo=totales`, e.ag.cookie);
  assert.match(totales.body, /data-modo="totales"/);
});

test('sábana por lotes: guardado JSON con versión; reenvío igual no cambia; versión vieja → 409 con los contadores del servidor', async () => {
  const e = await montar();
  e.abrir();
  const lote1 = e.sab({ votos: [2, 1, 0], matriz: { '1_1': 1, '2_1': 1 }, blancas: 1 });
  const a = await e.agPost('4-2-A', 'guardar', { ...lote1, auto: '1' }, true);
  assert.equal(a.statusCode, 200);
  assert.deepEqual([a.json().ok, a.json().version], [true, 1]);
  const repetido = await e.agPost('4-2-A', 'guardar', { ...lote1, version: 1 }, true);
  assert.equal(repetido.json().cambiado, false);
  assert.equal(e.cab('4-2-A').version, 1);
  const viejo = await e.agPost('4-2-A', 'guardar', { ...e.sab({ votos: [9, 9, 9], matriz: { '3_1': 9 } }), version: 0 }, true);
  assert.equal(viejo.statusCode, 409);
  assert.equal(viejo.json().estado, 'conflicto');
  assert.deepEqual([viejo.json().version, viejo.json().contadores.votos[e.ids[0]], viejo.json().contadores.matriz['1:1']], [1, 2, 1]);
  const lote2 = e.sab({ votos: [3, 2, 1], matriz: { '1_1': 1, '2_1': 1, '3_1': 1 }, blancas: 1, version: 1 });
  const b = await e.agPost('4-2-A', 'guardar', lote2, true);
  assert.deepEqual([b.json().ok, b.json().version], [true, 2]);
  const c = await e.agPost('4-2-A', 'guardar', { ...e.sab({ votos: [1, 0, 0], matriz: { '1_1': 5 } }), version: 2 }, true);
  assert.equal(c.statusCode, 422);
  assert.match(c.json().errores.join(' '), /no coinciden/);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM senado_matriz WHERE mesa_id = ?').get(e.mesa('4-2-A').id).n, 5);
});

test('modo por mesa: tras el primer dato en sábana, totales se rechaza (409) y la pantalla es siempre la de sábana', async () => {
  const e = await montar();
  e.abrir();
  await e.agPost('4-2-A', 'guardar', e.sab({ blancas: 1 }), true);
  const r = await e.agPost('4-2-A', 'guardar', { ...e.tot({ validas: 3 }), version: 1 }, true);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().estado, 'modo_distinto');
  const pantalla = await getAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/senado?modo=totales`, e.ag.cookie);
  assert.match(pantalla.body, /data-modo="sabana"/, 'el agente no cambia de modo ni pidiéndolo por la URL');
  assert.doesNotMatch(pantalla.body, /Usar «/);
});

test('cerrar mesa (totales): sin cuadre no cierra; cuadrada pide confirmación y luego cierra; cerrada no se edita', async () => {
  const e = await montar();
  e.abrir();
  const mal = await e.agPost('4-2-A', 'cerrar', e.tot({ ...TOT_OK, validas: 10, votos: [1, 1, 1, 0, 0, 0] }));
  assert.equal(mal.statusCode, 422);
  assert.match(mal.body, /entre las papeletas válidas/);
  const conf = await e.agPost('4-2-A', 'cerrar', e.tot(TOT_OK));
  assert.equal(conf.statusCode, 200);
  assert.match(conf.body, /¿Cerrar la mesa 4-2-A\?/);
  assert.equal(e.cab('4-2-A'), null);
  const ok = await e.agPost('4-2-A', 'cerrar', { ...e.tot(TOT_OK), confirmar: '1' });
  assert.equal(ok.statusCode, 302);
  assert.match(ok.headers.location, /senado_mesa_cerrada/);
  assert.equal(e.cab('4-2-A').estado, 'cerrado');
  assert.equal((await e.agPost('4-2-A', 'guardar', { ...e.tot({ ...TOT_OK, blancas: 5 }), version: 1 })).statusCode, 403);
  const vista = await getAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/senado`, e.ag.cookie);
  assert.doesNotMatch(vista.body, /form-senado/);
  assert.match(vista.body, /Mesa cerrada|está cerrada/);
});

test('permisos: un agente no toca el Senado de mesas ajenas (ni por fetch) y sin CSRF no se guarda', async () => {
  const e = await montar(DEMO_ISO, { mesas: ['4-2-A'] });
  e.abrir();
  const otra = e.mesa('4-2-B');
  assert.equal((await getAgente(e.app, `/agente/mesa/${otra.id}/senado`, e.ag.cookie)).statusCode, 403);
  const p = await postAgente(e.app, `/agente/mesa/${otra.id}/senado/guardar`, { _csrf: e.ag.csrf, ...e.tot({ validas: 5 }) }, e.ag.cookie, { headers: { cookie: `sid_agente=${e.ag.cookie}`, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'fetch' } });
  assert.equal(p.statusCode, 403);
  const sin = await postAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/senado/guardar`, e.tot({ validas: 5 }), e.ag.cookie);
  assert.equal(sin.statusCode, 403);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 0);
});

// ---------- Administrador ----------
test('administrador: introduce con el Senado cerrado, queda como introducido por admin y el agente no lo edita', async () => {
  const e = await montar();
  const g = await e.adPost('4-2-A', 'guardar', e.tot({ validas: 5, votos: [3] }));
  assert.equal(g.statusCode, 302);
  assert.equal(e.demo().prepare('SELECT introducido_por_tipo AS t FROM senado_mesa').get().t, 'admin');
  e.abrir();
  const ag = await e.agPost('4-2-A', 'guardar', { ...e.tot({ validas: 6, votos: [3] }), version: 1 });
  assert.equal(ag.statusCode, 403);
  const vista = await getAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/senado`, e.ag.cookie);
  assert.match(vista.body, /introdujo el administrador/);
});

test('administrador: cerrar con validación estricta, reabrir y reiniciar (con confirmación) para cambiar de modo; auditado', async () => {
  const e = await montar();
  const id = e.mesa('4-2-A').id;
  const mal = await e.adPost('4-2-A', 'cerrar', e.tot({ ...TOT_OK, validas: e.mesa('4-2-A').censo + 1 }));
  assert.equal(mal.statusCode, 422);
  const ok = await e.adPost('4-2-A', 'cerrar', { ...e.tot(TOT_OK), confirmar: '1' });
  assert.equal(ok.statusCode, 302);
  const ficha = await get(e.app, `/admin/senado/mesa/${id}`, e.ad.cookie);
  assert.match(ficha.body, /Reabrir la mesa/);
  assert.equal((await e.adPost('4-2-A', 'reabrir', { version: 1 })).statusCode, 302);
  assert.equal(e.demo().prepare('SELECT estado FROM senado_mesa').get().estado, 'borrador');
  const pide = await e.adPost('4-2-A', 'reiniciar', { version: 2 });
  assert.match(pide.body, /¿Reiniciar el Senado de la mesa 4-2-A\?/);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 1, 'sin confirmar no se borra');
  const hecho = await e.adPost('4-2-A', 'reiniciar', { version: 2, confirmar: '1' });
  assert.equal(hecho.statusCode, 302);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 0);
  const sab = await e.adPost('4-2-A', 'guardar', e.sab({ blancas: 2 }));
  assert.equal(sab.statusCode, 302, 'tras reiniciar el administrador puede empezar en sábana');
  assert.equal(e.demo().prepare('SELECT modo FROM senado_mesa').get().modo, 'sabana');
  const acciones = e.demo().prepare("SELECT accion FROM auditoria WHERE entidad = 'senado'").all().map((f) => f.accion);
  for (const a of ['cerrar', 'reabrir', 'reiniciar']) assert.ok(acciones.includes(a), a);
});

test('panel de resultados y matriz: solo suman mesas cerradas; histórico legible y sin autoguardados por defecto', async () => {
  const e = await montar();
  await e.adPost('4-2-A', 'cerrar', { ...e.tot(TOT_OK), confirmar: '1' });
  await e.adPost('4-2-B', 'guardar', e.tot({ validas: 50, votos: [40] }));
  const panel = await get(e.app, '/admin/senado', e.ad.cookie);
  assert.equal(panel.statusCode, 200);
  assert.match(panel.body, /PROVISIONAL · 1\/6 mesas escrutadas/);
  assert.match(panel.body, /class="pestanas"/);
  assert.match(panel.body, /% válidas/);
  assert.match(panel.body, /Por partido/);
  assert.match(panel.body, /id="sondeo"/);
  const nombre = listarCandidatos(e.db)[0].nombre;
  assert.match(panel.body, new RegExp(`${nombre}[\\s\\S]*?<td class="num">4</td><td class="num">40,00 %</td>`));
  assert.doesNotMatch(panel.body, /<td class="num">40<\/td>/, 'el borrador de la otra mesa no suma');
  // autoguardado oculto por defecto
  e.abrir();
  await e.agPost('4-2-A', 'guardar', { ...e.sab({ blancas: 1 }), auto: '1' }, true).catch(() => {});
  const hist = await get(e.app, '/admin/historico', e.ad.cookie);
  assert.match(hist.body, /Senado · mesa 4-2-A|Mesa 4-2-A/);
  assert.match(hist.body, new RegExp(`${nombre} sin rellenar → 4`));
  assert.doesNotMatch(hist.body, /Autoguardado/);
});

test('REAL: el Senado escribe en app.db y el pantallazo del Congreso no cambia; los estáticos del Senado se sirven', async () => {
  const e = await montar(REAL_21H);
  const m = e.mesa('4-2-A');
  const g = await e.adPost('4-2-A', 'guardar', e.tot({ validas: 5, votos: [3] }));
  assert.equal(g.statusCode, 302);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM senado_mesa WHERE mesa_id = ?').get(m.id).n, 1);
  for (const url of ['/senado.js', '/papeleta.js']) {
    const r = await get(e.app, url);
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], 'no-cache');
  }
  assert.match((await get(e.app, '/papeleta.js')).headers['content-type'], /javascript/);
});
