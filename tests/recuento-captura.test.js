import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ConflictoVersionError, ModoCambiadoError } from '../src/captura.js';
import { GestorDatos } from '../src/datos.js';
import { abrirDb, migrarApp } from '../src/db.js';
import { estructuraBloqueada, fijarAbierto, recuentoAbierto, recuentoActivado } from '../src/recuentoEstado.js';
import { sembrar } from '../src/seed.js';
import { CONFIG, crearDirectorioTemporal, crearReloj } from './ayuda.js';

const DIA = '2026-11-29T21:00:00Z';
const ADMIN = { tipo: 'admin', id: 1 };
const AGENTE = { tipo: 'agente', id: 7 };
const OTRO_AGENTE = { tipo: 'agente', id: 8 };
const mapa = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

async function montar(iso = '2026-10-20T10:00:00Z') {
  const dataDir = crearDirectorioTemporal();
  const db = abrirDb(path.join(dataDir, 'app.db'));
  migrarApp(db);
  await sembrar(db, { ...CONFIG, dataDir });
  const reloj = crearReloj(iso);
  const gestor = new GestorDatos({ db, dataDir, fechaElecciones: CONFIG.fechaElecciones, reloj: reloj.ahora });
  gestor.sincronizar();
  const mesa = db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1').get().id;
  const cand = (n) => Number(db.prepare("INSERT INTO candidatura (nombre, siglas, orden) VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM candidatura))").run(`Candidatura ${n}`, `C${n}`).lastInsertRowid);
  const ids = [cand(1), cand(2), cand(3)];
  return { gestor, db, dataDir, reloj, mesa, ids, rutaDemo: gestor.rutaDemo };
}
const guardar = (g, valores, extra = {}) =>
  g.gestor.captura().guardarRecuento({ mesaId: g.mesa, valores, estado: 'borrador', versionEsperada: 0, actor: AGENTE, ...extra });
const v = (g, o = {}) => ({ votantes: undefined, blancos: undefined, nulos: undefined, votos: new Map(), ...o });
const auditoriaRecuento = (g, destino = 'demo') => {
  const d = destino === 'demo' ? new Database(g.rutaDemo, { readonly: true }) : g.db;
  const filas = d.prepare("SELECT * FROM auditoria WHERE entidad = 'recuento' ORDER BY id").all();
  if (destino === 'demo') d.close();
  return filas;
};

test('guardar un borrador: version 1; «sin rellenar» (null) se distingue de 0', async () => {
  const g = await montar();
  const [a, b, c] = g.ids;
  const r = guardar(g, v(g, { votantes: 100, blancos: 0, nulos: null, votos: mapa({ [a]: 60, [b]: 0, [c]: null }) }));
  assert.deepEqual([r.cambiado, r.version], [true, 1]);
  const { cab, votos } = g.gestor.captura().obtenerRecuento(g.mesa);
  assert.deepEqual([cab.estado, cab.votantes, cab.votos_blancos, cab.votos_nulos, cab.version], ['borrador', 100, 0, null, 1]);
  assert.deepEqual([...votos], [[a, 60], [b, 0]], 'el 0 se guarda; lo sin rellenar no tiene fila');
  assert.equal(votos.has(c), false);
  assert.deepEqual([cab.introducido_por_tipo, cab.introducido_por_id], ['agente', 7]);
  g.gestor.cerrar();
});

test('control de versión: un guardado con versión vieja se rechaza y no escribe nada', async () => {
  const g = await montar();
  const [a] = g.ids;
  guardar(g, v(g, { votos: mapa({ [a]: 5 }) }));
  assert.throws(() => guardar(g, v(g, { votos: mapa({ [a]: 99 }) }), { versionEsperada: 0 }), (e) => e instanceof ConflictoVersionError && e.versionActual === 1);
  assert.equal(g.gestor.captura().obtenerRecuento(g.mesa).votos.get(a), 5);
  const ok = guardar(g, v(g, { votos: mapa({ [a]: 6 }) }), { versionEsperada: 1 });
  assert.equal(ok.version, 2);
  assert.throws(() => g.gestor.captura().reabrirRecuento({ mesaId: g.mesa, versionEsperada: 1, actor: ADMIN }), ConflictoVersionError);
  g.gestor.cerrar();
});

test('la auditoría guarda solo lo que cambia (quién, cuándo, antes y después)', async () => {
  const g = await montar();
  const [a, b] = g.ids;
  guardar(g, v(g, { votantes: 50, votos: mapa({ [a]: 10, [b]: 20 }) }));
  guardar(g, v(g, { votos: mapa({ [a]: 11 }) }), { versionEsperada: 1, automatico: true });
  const [primera, segunda] = auditoriaRecuento(g);
  assert.equal(primera.accion, 'guardar');
  assert.equal(primera.valor_anterior, null);
  assert.deepEqual(JSON.parse(primera.valor_nuevo).votos, { [a]: 10, [b]: 20 });
  assert.equal(segunda.accion, 'autoguardar');
  assert.deepEqual(JSON.parse(segunda.valor_anterior), { mesa_id: g.mesa, votos: { [a]: 10 } });
  assert.deepEqual(JSON.parse(segunda.valor_nuevo), { mesa_id: g.mesa, votos: { [a]: 11 } });
  assert.equal(segunda.actor_tipo, 'agente');
  assert.ok(segunda.fecha.endsWith('Z'));
  assert.equal(segunda.entidad_id, g.mesa);
  g.gestor.cerrar();
});

test('guardar sin cambios no escribe, no sube la versión y no audita', async () => {
  const g = await montar();
  const [a] = g.ids;
  guardar(g, v(g, { votantes: 10, votos: mapa({ [a]: 3 }) }));
  const r = guardar(g, v(g, { votantes: 10, votos: mapa({ [a]: 3 }) }), { versionEsperada: 1 });
  assert.deepEqual([r.cambiado, r.version], [false, 1]);
  assert.equal(auditoriaRecuento(g).length, 1);
  g.gestor.cerrar();
});

test('vaciar un campo (null) borra su fila: vuelve a «sin rellenar»', async () => {
  const g = await montar();
  const [a, b] = g.ids;
  guardar(g, v(g, { blancos: 2, votos: mapa({ [a]: 3, [b]: 4 }) }));
  guardar(g, v(g, { blancos: null, votos: mapa({ [a]: null }) }), { versionEsperada: 1 });
  const { cab, votos } = g.gestor.captura().obtenerRecuento(g.mesa);
  assert.equal(cab.votos_blancos, null);
  assert.deepEqual([...votos], [[b, 4]]);
  g.gestor.cerrar();
});

test('cerrar, editar lo cerrado y reabrir: acciones y autoría', async () => {
  const g = await montar();
  const [a] = g.ids;
  guardar(g, v(g, { votantes: 10, votos: mapa({ [a]: 10 }) }));                      // borrador por un agente
  const cierre = guardar(g, v(g), { versionEsperada: 1, estado: 'cerrado', actor: ADMIN }); // el admin solo cierra
  assert.equal(cierre.version, 2);
  let { cab } = g.gestor.captura().obtenerRecuento(g.mesa);
  assert.deepEqual([cab.estado, cab.introducido_por_tipo, cab.introducido_por_id], ['cerrado', 'agente', 7], 'cerrar sin tocar números no cambia la autoría');

  const edicion = guardar(g, v(g, { votos: mapa({ [a]: 11 }), votantes: 11 }), { versionEsperada: 2, estado: 'cerrado', actor: ADMIN });
  assert.equal(edicion.version, 3);
  ({ cab } = g.gestor.captura().obtenerRecuento(g.mesa));
  assert.deepEqual([cab.estado, cab.introducido_por_tipo], ['cerrado', 'admin'], 'cambiar números sí cambia la autoría');

  const reabre = g.gestor.captura().reabrirRecuento({ mesaId: g.mesa, versionEsperada: 3, actor: ADMIN });
  assert.deepEqual([reabre.cambiado, reabre.version], [true, 4]);
  ({ cab } = g.gestor.captura().obtenerRecuento(g.mesa));
  assert.deepEqual([cab.estado, cab.introducido_por_tipo, cab.votantes], ['borrador', 'admin', 11], 'reabrir conserva datos y autoría');
  assert.equal(g.gestor.captura().reabrirRecuento({ mesaId: g.mesa, versionEsperada: 4, actor: ADMIN }).cambiado, false, 'reabrir una mesa ya abierta no hace nada');

  assert.deepEqual(auditoriaRecuento(g).map((f) => f.accion), ['guardar', 'cerrar', 'editar', 'reabrir']);
  const cerrar = JSON.parse(auditoriaRecuento(g)[1].valor_nuevo);
  assert.deepEqual(cerrar, { mesa_id: g.mesa, estado: 'cerrado' });
  g.gestor.cerrar();
});

test('un agente distinto puede sobrescribir un borrador de otro (la autoría pasa al último que cambia números)', async () => {
  const g = await montar();
  const [a] = g.ids;
  guardar(g, v(g, { votos: mapa({ [a]: 1 }) }));
  guardar(g, v(g, { votos: mapa({ [a]: 2 }) }), { versionEsperada: 1, actor: OTRO_AGENTE });
  assert.equal(g.gestor.captura().obtenerRecuento(g.mesa).cab.introducido_por_id, 8);
  g.gestor.cerrar();
});

test('listarRecuentos agrupa cabecera y votos por mesa', async () => {
  const g = await montar();
  const [a, b] = g.ids;
  const otraMesa = g.db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1 OFFSET 1').get().id;
  guardar(g, v(g, { votos: mapa({ [a]: 5 }) }));
  g.gestor.captura().guardarRecuento({ mesaId: otraMesa, valores: v(g, { votos: mapa({ [b]: 7 }) }), estado: 'borrador', versionEsperada: 0, actor: AGENTE });
  const todos = g.gestor.captura().listarRecuentos();
  assert.deepEqual([todos.size, todos.get(g.mesa).votos.get(a), todos.get(otraMesa).votos.get(b)], [2, 5, 7]);
  g.gestor.cerrar();
});

test('AISLAMIENTO: en DEMO el recuento va solo a demo.db; app.db no cambia ni una fila de captura', async () => {
  const g = await montar();
  const [a] = g.ids;
  const foto = () => JSON.stringify({
    cab: g.db.prepare('SELECT * FROM recuento_mesa').all(),
    votos: g.db.prepare('SELECT * FROM recuento_voto').all(),
    aud: g.db.prepare("SELECT * FROM auditoria WHERE entidad = 'recuento'").all(),
  });
  const antes = foto();
  guardar(g, v(g, { votantes: 5, votos: mapa({ [a]: 5 }) }));
  guardar(g, v(g), { versionEsperada: 1, estado: 'cerrado', actor: ADMIN });
  g.gestor.captura().reabrirRecuento({ mesaId: g.mesa, versionEsperada: 2, actor: ADMIN });
  assert.equal(foto(), antes, 'app.db intacta');
  const demo = new Database(g.rutaDemo, { readonly: true });
  assert.equal(demo.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 1);
  assert.equal(demo.prepare('SELECT COUNT(*) n FROM recuento_voto').get().n, 1);
  assert.equal(demo.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'recuento'").get().n, 3);
  demo.close();
  g.gestor.cerrar();
});

test('en REAL el recuento va a app.db, con su auditoría, y no existe demo.db', async () => {
  const g = await montar(DIA);
  g.gestor.sincronizar();
  const [a] = g.ids;
  guardar(g, v(g, { votantes: 5, votos: mapa({ [a]: 5 }) }));
  assert.equal(g.db.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 1);
  assert.equal(g.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'recuento'").get().n, 1);
  assert.ok(!existsSync(g.rutaDemo));
  g.gestor.cerrar();
});

test('una Captura obtenida antes de cambiar de modo no puede escribir el recuento en el otro destino', async () => {
  const g = await montar();
  const vieja = g.gestor.captura();
  g.gestor.cambiarModo('REAL', ADMIN);
  assert.throws(() => vieja.guardarRecuento({ mesaId: g.mesa, valores: v(g), estado: 'borrador', versionEsperada: 0, actor: AGENTE }), ModoCambiadoError);
  assert.equal(g.db.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 0);
  g.gestor.cerrar();
});

test('contarVotosPorCandidatura lee ambos destinos sin escribir', async () => {
  const g = await montar();
  const [a, b] = g.ids;
  guardar(g, v(g, { votos: mapa({ [a]: 1, [b]: 0 }) }));
  g.db.prepare('INSERT INTO recuento_voto (mesa_id, candidatura_id, votos) VALUES (?, ?, 3)').run(g.mesa, a);
  const { real, demo } = g.gestor.contarVotosPorCandidatura();
  assert.deepEqual([real.get(a), demo.get(a), demo.get(b), real.get(b)], [1, 1, 1, undefined]);
  g.gestor.cerrar();
});

// ---------- Apertura y bloqueo por modo ----------
test('abrir el recuento es POR MODO: abrirlo en DEMO no lo abre en REAL, y REAL arranca cerrado', async () => {
  const g = await montar();
  assert.deepEqual([recuentoAbierto(g.db, 'DEMO'), recuentoAbierto(g.db, 'REAL')], [false, false]);
  fijarAbierto(g.db, 'DEMO', true);
  assert.deepEqual([recuentoAbierto(g.db, 'DEMO'), recuentoAbierto(g.db, 'REAL')], [true, false]);
  assert.deepEqual([recuentoActivado(g.db, 'DEMO'), recuentoActivado(g.db, 'REAL')], [true, false]);
  g.gestor.cambiarModo('REAL', ADMIN); // sale de DEMO: la demo se descarta con sus banderas
  assert.deepEqual([recuentoAbierto(g.db, 'DEMO'), recuentoAbierto(g.db, 'REAL'), recuentoActivado(g.db, 'DEMO')], [false, false, false]);
  g.gestor.cerrar();
});

test('la llegada automática del 29N tampoco hereda un recuento abierto de la demo', async () => {
  const g = await montar('2026-11-28T22:00:00Z');
  fijarAbierto(g.db, 'DEMO', true);
  g.reloj.fijar('2026-11-28T23:00:00Z'); // 00:00 en Madrid: pasa a REAL solo
  assert.equal(g.gestor.sincronizar().modo, 'REAL');
  assert.deepEqual([recuentoAbierto(g.db, 'REAL'), recuentoAbierto(g.db, 'DEMO')], [false, false]);
  g.gestor.cerrar();
});

test('«Reiniciar demo» y volver a entrar en DEMO desbloquean la estructura y cierran el recuento de la demo', async () => {
  const g = await montar();
  fijarAbierto(g.db, 'DEMO', true);
  assert.equal(estructuraBloqueada(g.db, 'DEMO'), true);
  g.gestor.reiniciarDemo(ADMIN);
  assert.deepEqual([recuentoAbierto(g.db, 'DEMO'), recuentoActivado(g.db, 'DEMO'), estructuraBloqueada(g.db, 'DEMO')], [false, false, false]);
  g.gestor.cerrar();
});

test('estructura bloqueada: REAL activado la bloquea siempre (también en DEMO); la demo solo mientras se está en DEMO', async () => {
  const g = await montar();
  assert.equal(estructuraBloqueada(g.db, 'REAL'), false);
  fijarAbierto(g.db, 'REAL', true);
  fijarAbierto(g.db, 'REAL', false); // se cierra, pero sigue «activado»
  assert.equal(recuentoAbierto(g.db, 'REAL'), false);
  assert.equal(estructuraBloqueada(g.db, 'REAL'), true, 'cerrar el recuento no desbloquea');
  assert.equal(estructuraBloqueada(g.db, 'DEMO'), true, 'REAL activado bloquea también estando en DEMO');
  g.gestor.cerrar();
});
