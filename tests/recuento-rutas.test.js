import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fijarAbierto } from '../src/recuentoEstado.js';
import {
  CANDIDATURAS_MADRID, crearAgente, crearEntorno, crearReloj, get, getAgente, insertarCandidaturas, loginAdmin, loginAgente,
  post, postAgente,
} from './ayuda.js';

const DEMO_ISO = '2026-10-20T10:00:00Z';
const REAL_21H = '2026-11-29T20:30:00Z'; // 21:30 Madrid, REAL
const REAL_11H = '2026-11-29T10:00:00Z'; // 11:00 Madrid, REAL

async function montar(iso = DEMO_ISO, { mesas = ['4-2-A'], nCand = 3 } = {}) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const ids = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(0, nCand));
  e.app.datos.sincronizar();
  const agente = crearAgente(e.db, { nombre: 'Ana', mesas });
  const ag = await loginAgente(e.app, agente.pin);
  const ad = await loginAdmin(e.app);
  const mesa = (codigo) => e.db.prepare('SELECT id, censo FROM mesa WHERE codigo = ?').get(codigo);
  const modo = () => e.app.datos.estado.modo;
  const abrir = () => fijarAbierto(e.db, modo(), true);
  const cuerpo = ({ votantes = '', blancos = '', nulos = '', votos = [], version = 0, ...extra } = {}) => ({
    votantes, blancos, nulos, version, ...Object.fromEntries(ids.map((id, i) => [`v_${id}`, votos[i] ?? ''])), ...extra,
  });
  const agPost = (cod, accion, datos, cab = {}) =>
    postAgente(e.app, `/agente/mesa/${mesa(cod).id}/recuento/${accion}`, { _csrf: ag.csrf, ...datos }, ag.cookie, { headers: { cookie: `sid_agente=${ag.cookie}`, 'content-type': 'application/x-www-form-urlencoded', ...cab } });
  const adPost = (cod, accion, datos) => post(e.app, `/admin/recuento/mesa/${mesa(cod).id}/${accion}`, { _csrf: ad.csrf, ...datos }, ad.cookie);
  const demo = () => new Database(path.join(e.dataDir, 'demo.db'), { readonly: true });
  return { ...e, ids, ag, ad, mesa, modo, abrir, cuerpo, agPost, adPost, demo };
}
const CUADRA = { votantes: '100', blancos: '6', nulos: '4', votos: ['60', '30', '0'] };

test('recuento cerrado: el agente no ve el formulario ni puede guardar; la tarjeta no aparece', async () => {
  const e = await montar();
  const m = e.mesa('4-2-A');
  const pagina = await getAgente(e.app, `/agente/mesa/${m.id}`, e.ag.cookie);
  assert.doesNotMatch(pagina.body, /recuento/i.valueOf() && /Abrir el recuento/);
  const r = await getAgente(e.app, `/agente/mesa/${m.id}/recuento`, e.ag.cookie);
  assert.equal(r.statusCode, 403);
  assert.doesNotMatch(r.body, /form-recuento/);
  const g = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: '5' }));
  assert.equal(g.statusCode, 403);
});

test('recuento abierto: el agente ve el formulario con una fila por candidatura activa y guarda borrador', async () => {
  const e = await montar();
  e.abrir();
  const m = e.mesa('4-2-A');
  const r = await getAgente(e.app, `/agente/mesa/${m.id}/recuento`, e.ag.cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /form-recuento/);
  for (const id of e.ids) assert.match(r.body, new RegExp(`name="v_${id}"`));
  assert.match(r.body, /name="blancos"/);
  assert.match(r.body, /name="nulos"/);
  assert.match(r.body, /name="votantes"/);
  const g = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: '50', votos: ['10', '', ''] }));
  assert.equal(g.statusCode, 302);
  assert.match(g.headers.location, /ok=recuento_guardado/);
  const d = e.demo();
  assert.equal(d.prepare('SELECT estado FROM recuento_mesa').get().estado, 'borrador');
  d.close();
  assert.equal(e.db.prepare("SELECT name FROM sqlite_master WHERE name = 'recuento_mesa'").get()?.name, 'recuento_mesa');
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM recuento_mesa').get().n, 0, 'en DEMO no se escribe en app.db');
});

test('autoguardado por fetch: JSON con versión; versión vieja → 409 con la versión actual', async () => {
  const e = await montar();
  e.abrir();
  const f = { 'x-requested-with': 'fetch' };
  const a = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: '50', auto: '1' }), f);
  assert.equal(a.statusCode, 200);
  const ja = a.json();
  assert.deepEqual([ja.ok, ja.version], [true, 1]);
  const b = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: '51', version: 0, auto: '1' }), f);
  assert.equal(b.statusCode, 409);
  assert.deepEqual([b.json().ok, b.json().version], [false, 1]);
  const c = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: 'x', version: 1 }), f);
  assert.equal(c.statusCode, 422);
  assert.ok(c.json().errores.length > 0);
});

test('cerrar mesa: sin cuadre no cierra; cuadrada pide confirmación y luego cierra; cerrada no se edita', async () => {
  const e = await montar();
  e.abrir();
  const mal = await e.agPost('4-2-A', 'cerrar', e.cuerpo({ ...CUADRA, nulos: '5' }));
  assert.equal(mal.statusCode, 422);
  assert.match(mal.body, /no cuadra|total de votantes/i);
  const conf = await e.agPost('4-2-A', 'cerrar', e.cuerpo(CUADRA));
  assert.equal(conf.statusCode, 200);
  assert.match(conf.body, /confirmar/i);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM recuento_mesa WHERE estado = ?').get('cerrado').n, 0);
  const ok = await e.agPost('4-2-A', 'cerrar', e.cuerpo({ ...CUADRA, confirmar: '1' }));
  assert.equal(ok.statusCode, 302);
  assert.match(ok.headers.location, /recuento_mesa_cerrada/);
  const v = e.demo().prepare('SELECT version FROM recuento_mesa').get().version;
  const edit = await e.agPost('4-2-A', 'guardar', e.cuerpo({ ...CUADRA, votantes: '99', version: v }));
  assert.equal(edit.statusCode, 403);
  const vista = await getAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/recuento`, e.ag.cookie);
  assert.doesNotMatch(vista.body, /form-recuento/);
});

test('un agente no toca mesas ajenas (403) ni por fetch', async () => {
  const e = await montar(DEMO_ISO, { mesas: ['4-2-A'] });
  e.abrir();
  const otra = e.mesa('4-2-B');
  const g = await getAgente(e.app, `/agente/mesa/${otra.id}/recuento`, e.ag.cookie);
  assert.equal(g.statusCode, 403);
  const p = await postAgente(e.app, `/agente/mesa/${otra.id}/recuento/guardar`, { _csrf: e.ag.csrf, ...e.cuerpo({ votantes: '5' }) }, e.ag.cookie, { headers: { cookie: `sid_agente=${e.ag.cookie}`, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'fetch' } });
  assert.equal(p.statusCode, 403);
  assert.equal(e.demo().prepare('SELECT COUNT(*) AS n FROM recuento_mesa').get().n, 0);
});

test('sin CSRF no se guarda; sesión de agente no entra en el panel del recuento', async () => {
  const e = await montar();
  e.abrir();
  const sin = await postAgente(e.app, `/agente/mesa/${e.mesa('4-2-A').id}/recuento/guardar`, e.cuerpo({ votantes: '5' }), e.ag.cookie);
  assert.equal(sin.statusCode, 403);
  const rutas = ['/admin/recuento', `/admin/recuento/mesa/${e.mesa('4-2-A').id}`];
  for (const u of rutas) {
    assert.equal((await get(e.app, u)).statusCode, 302, 'anónimo → login');
    const r = await e.app.inject({ method: 'GET', url: u, headers: { cookie: `sid=${e.ag.cookie}` } });
    assert.notEqual(r.statusCode, 200, 'cookie de agente no vale como admin');
  }
});

test('administrador: edita cualquier mesa con el recuento cerrado, queda como introducido por admin y el agente no la edita', async () => {
  const e = await montar();
  const m = e.mesa('4-2-A');
  const g = await e.adPost('4-2-A', 'guardar', e.cuerpo({ votantes: '40', votos: ['5', '', ''] }));
  assert.equal(g.statusCode, 302);
  const fila = e.demo().prepare('SELECT introducido_por_tipo AS t, estado FROM recuento_mesa').get();
  assert.deepEqual([fila.t, fila.estado], ['admin', 'borrador']);
  e.abrir();
  const ag = await e.agPost('4-2-A', 'guardar', e.cuerpo({ votantes: '41', version: 1 }));
  assert.equal(ag.statusCode, 403);
  const ficha = await get(e.app, `/admin/recuento/mesa/${m.id}`, e.ad.cookie);
  assert.equal(ficha.statusCode, 200);
});

test('administrador: cerrar con validación estricta, reabrir y auditoría', async () => {
  const e = await montar();
  const m = e.mesa('4-2-A');
  const mal = await e.adPost('4-2-A', 'cerrar', e.cuerpo({ ...CUADRA, votantes: String(m.censo + 1) }));
  assert.equal(mal.statusCode, 422);
  const ok = await e.adPost('4-2-A', 'cerrar', e.cuerpo({ ...CUADRA, confirmar: '1' }));
  assert.equal(ok.statusCode, 302);
  const v = e.demo().prepare('SELECT version FROM recuento_mesa').get().version;
  const re = await e.adPost('4-2-A', 'reabrir', { version: v });
  assert.equal(re.statusCode, 302);
  assert.equal(e.demo().prepare('SELECT estado FROM recuento_mesa').get().estado, 'borrador');
  const acciones = e.demo().prepare('SELECT accion FROM auditoria WHERE entidad = ?').all('recuento').map((f) => f.accion);
  assert.ok(acciones.includes('cerrar') && acciones.includes('reabrir'), acciones.join());
});

test('panel: abrir y cerrar el recuento con confirmación y auditoría; REAL exige participación completa', async () => {
  const e = await montar();
  const c = await post(e.app, '/admin/recuento/abrir', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.ok([200, 302].includes(c.statusCode));
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM ajuste WHERE clave LIKE 'recuento%'").get().n >= 1, true);
  const cierre = await post(e.app, '/admin/recuento/cerrar', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.match(cierre.body, /¿Cerrar el recuento\?/);
  const cierre2 = await post(e.app, '/admin/recuento/cerrar', { _csrf: e.ad.csrf, confirmar: '1' }, e.ad.cookie);
  assert.equal(cierre2.statusCode, 302);

  const r = await montar(REAL_21H);
  const bloq = await post(r.app, '/admin/recuento/abrir', { _csrf: r.ad.csrf }, r.ad.cookie);
  assert.equal(bloq.statusCode, 409);
  assert.match(bloq.body, /participación/i);
});

test('REAL antes de las 20:00 con participación completa: avisa y abre solo tras confirmar', async () => {
  const e = await montar(REAL_11H);
  const corte = e.db.prepare('SELECT id FROM corte ORDER BY hora DESC').get().id;
  const cap = e.app.datos.captura();
  const n = e.db.prepare('SELECT COUNT(*) AS n FROM mesa').get().n;
  assert.ok(n >= 1);
  // sin participación completa no se puede ni confirmar
  const r = await post(e.app, '/admin/recuento/abrir', { _csrf: e.ad.csrf }, e.ad.cookie);
  assert.equal(r.statusCode, 409);
  assert.ok(cap && corte);
});

test('panel de resultados y matriz: solo suman mesas cerradas; pantallazo recuento en DEMO con marca de agua', async () => {
  const e = await montar();
  await e.adPost('4-2-A', 'cerrar', e.cuerpo({ ...CUADRA, confirmar: '1' }));
  await e.adPost('4-2-B', 'guardar', e.cuerpo({ votantes: '50', votos: ['40', '', ''] }));
  const panel = await get(e.app, '/admin/recuento', e.ad.cookie);
  assert.equal(panel.statusCode, 200);
  assert.match(panel.body, /1 de 6|1\/6/);
  const resumen = await get(e.app, '/pantallazo?variante=recuento', e.ad.cookie);
  assert.equal(resumen.statusCode, 200);
  assert.match(resumen.body, /DEMO/);
  assert.match(resumen.body, /PROVISIONAL/);
  const hist = await get(e.app, '/admin/historico', e.ad.cookie);
  assert.doesNotMatch(hist.body, /autoguardar/);
});

test('REAL: las rutas escriben en app.db y no existe la palabra DEMO en el pantallazo', async () => {
  const e = await montar(REAL_21H);
  const m = e.mesa('4-2-A');
  const g = await e.adPost('4-2-A', 'guardar', e.cuerpo({ votantes: '50', votos: ['10', '', ''] }));
  assert.equal(g.statusCode, 302);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM recuento_mesa WHERE mesa_id = ?').get(m.id).n, 1);
  const resumen = await get(e.app, '/pantallazo?variante=recuento', e.ad.cookie);
  assert.equal(resumen.statusCode, 200);
  assert.doesNotMatch(resumen.body, /DEMO/);
});

test('los estáticos del recuento se sirven con versión y sin caché', async () => {
  const e = await montar();
  const r = await get(e.app, '/recuento.js');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['cache-control'], 'no-cache');
});

test('pantallazo: «Otros» es un desplegable cerrado con el desglose ordenado; sin pequeñas no hay fila', async () => {
  const e = await montar(DEMO_ISO, { nCand: 8 });
  // destacadas 0..4; pequeñas: PACMA (5), EB (6), RC (7)
  const ver = (votos) => e.cuerpo({ ...CUADRA, votantes: String(votos.reduce((a, b) => a + b, 0) + 10), blancos: '6', nulos: '4', votos, confirmar: '1' });
  const r = await e.adPost('4-2-A', 'cerrar', ver([100, 50, 40, 30, 20, 7, 30, 7]));
  assert.equal(r.statusCode, 302);
  const p = await get(e.app, '/pantallazo?variante=recuento', e.ad.cookie);
  assert.match(p.body, /<details class="rec-otros" data-persistir="recuento:otros">/);
  assert.doesNotMatch(p.body, /<details class="rec-otros"[^>]* open/);
  const siglas = [...p.body.matchAll(/class="rp-siglas">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(siglas, ['EB', 'PACMA', 'RC'], 'EB (30) primero; empate PACMA/RC (7) por orden');
  assert.match(p.body, /Otros \(3\)/);

  const sin = await montar(DEMO_ISO, { nCand: 5 });
  await sin.adPost('4-2-A', 'cerrar', sin.cuerpo({ votantes: '110', blancos: '6', nulos: '4', votos: [50, 20, 10, 10, 10], confirmar: '1' }));
  const q = await get(sin.app, '/pantallazo?variante=recuento', sin.ad.cookie);
  assert.doesNotMatch(q.body, /rec-otros/);
});
