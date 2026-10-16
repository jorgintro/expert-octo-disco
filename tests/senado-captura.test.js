import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { ConflictoVersionError, ModoSenadoError } from '../src/captura.js';
import { GestorDatos } from '../src/datos.js';
import { abrirDb, migrarApp } from '../src/db.js';
import { sembrar } from '../src/seed.js';
import { CONFIG, crearDirectorioTemporal, crearReloj } from './ayuda.js';

const DIA = '2026-11-29T21:00:00Z';
const ADMIN = { tipo: 'admin', id: 1 };
const AGENTE = { tipo: 'agente', id: 7 };
const mapa = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

async function montar(iso = '2026-10-20T10:00:00Z') {
  const dataDir = crearDirectorioTemporal();
  const db = abrirDb(path.join(dataDir, 'app.db'));
  migrarApp(db);
  await sembrar(db, { ...CONFIG, dataDir });
  const gestor = new GestorDatos({ db, dataDir, fechaElecciones: CONFIG.fechaElecciones, reloj: crearReloj(iso).ahora });
  gestor.sincronizar();
  const mesa = db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1').get().id;
  return { gestor, db, dataDir, mesa, rutaDemo: gestor.rutaDemo };
}
const sab = (extra = {}) => ({ modo: 'sabana', votos: mapa({ 1: 2, 2: 1 }), matriz: new Map([['1:1', 1], ['2:1', 1], ['2:0', 0], ['3:0', 0], ['3:1', 0]]), validas: 2, blancas: 1, nulas: 0, ...extra });
const tot = (extra = {}) => ({ modo: 'totales', votos: mapa({ 1: 5, 2: null }), matriz: null, validas: 5, blancas: null, nulas: 1, ...extra });
const guardar = (g, valores, extra = {}) =>
  g.gestor.captura().guardarSenado({ mesaId: g.mesa, valores, estado: 'borrador', versionEsperada: 0, actor: AGENTE, ...extra });
const auditoria = (g, destino = 'demo') => {
  const d = destino === 'demo' ? new Database(g.rutaDemo, { readonly: true }) : g.db;
  const filas = d.prepare("SELECT * FROM auditoria WHERE entidad = 'senado' ORDER BY id").all();
  if (destino === 'demo') d.close();
  return filas;
};

test('guardar en sábana: cabecera, votos y matriz; el modo queda fijado y la matriz guardada', async () => {
  const g = await montar();
  const r = guardar(g, sab());
  assert.deepEqual([r.cambiado, r.version], [true, 1]);
  const { cab, votos, matriz } = g.gestor.captura().obtenerSenado(g.mesa);
  assert.deepEqual([cab.modo, cab.estado, cab.validas, cab.blancas, cab.nulas, cab.version], ['sabana', 'borrador', 2, 1, 0, 1]);
  assert.deepEqual([...votos], [[1, 2], [2, 1]]);
  assert.equal(matriz.get('1:1'), 1);
  assert.equal(matriz.get('2:1'), 1);
  assert.deepEqual([cab.introducido_por_tipo, cab.introducido_por_id], ['agente', 7]);
  g.gestor.cerrar();
});

test('guardar en totales: «sin rellenar» ≠ 0 y la matriz queda vacía («no disponible»)', async () => {
  const g = await montar();
  guardar(g, tot());
  const { cab, votos, matriz } = g.gestor.captura().obtenerSenado(g.mesa);
  assert.deepEqual([cab.modo, cab.validas, cab.blancas, cab.nulas], ['totales', 5, null, 1]);
  assert.deepEqual([...votos], [[1, 5]], 'lo sin rellenar no tiene fila');
  assert.equal(matriz.size, 0);
  g.gestor.cerrar();
});

test('el modo se fija con el primer guardado: cambiarlo lanza ModoSenadoError sin escribir; reiniciar lo libera', async () => {
  const g = await montar();
  guardar(g, sab());
  assert.throws(() => guardar(g, tot(), { versionEsperada: 1 }), (e) => e instanceof ModoSenadoError && e.modoActual === 'sabana');
  assert.equal(g.gestor.captura().obtenerSenado(g.mesa).cab.modo, 'sabana');
  g.gestor.captura().reiniciarSenado({ mesaId: g.mesa, versionEsperada: 1, actor: ADMIN });
  const vacio = g.gestor.captura().obtenerSenado(g.mesa);
  assert.deepEqual([vacio.cab, vacio.votos.size, vacio.matriz.size], [null, 0, 0]);
  assert.equal(guardar(g, tot()).version, 1, 'tras reiniciar se empieza de nuevo, ya en el otro modo');
  g.gestor.cerrar();
});

test('control de versión: con versión vieja se rechaza sin escribir; reabrir y reiniciar también lo respetan', async () => {
  const g = await montar();
  guardar(g, sab());
  assert.throws(() => guardar(g, sab({ blancas: 9 }), { versionEsperada: 0 }), (e) => e instanceof ConflictoVersionError && e.versionActual === 1);
  assert.equal(g.gestor.captura().obtenerSenado(g.mesa).cab.blancas, 1);
  assert.throws(() => g.gestor.captura().reiniciarSenado({ mesaId: g.mesa, versionEsperada: 0, actor: ADMIN }), ConflictoVersionError);
  guardar(g, sab(), { versionEsperada: 1, estado: 'cerrado' });
  assert.throws(() => g.gestor.captura().reabrirSenado({ mesaId: g.mesa, versionEsperada: 1, actor: ADMIN }), ConflictoVersionError);
  const r = g.gestor.captura().reabrirSenado({ mesaId: g.mesa, versionEsperada: 2, actor: ADMIN });
  assert.deepEqual([r.cambiado, r.version], [true, 3]);
  const { cab } = g.gestor.captura().obtenerSenado(g.mesa);
  assert.deepEqual([cab.estado, cab.introducido_por_tipo], ['borrador', 'agente'], 'reabrir conserva la autoría');
  g.gestor.cerrar();
});

test('auditoría de diferencias: solo lo que cambia; guardar igual no audita; autoguardar, cerrar, reabrir y reiniciar con su acción', async () => {
  const g = await montar();
  guardar(g, sab(), { automatico: true });
  assert.equal(guardar(g, sab(), { versionEsperada: 1 }).cambiado, false, 'sin cambios: ni versión ni auditoría');
  guardar(g, sab({ votos: mapa({ 1: 3, 2: 1 }), blancas: 2 }), { versionEsperada: 1 });
  guardar(g, sab({ votos: mapa({ 1: 3, 2: 1 }), blancas: 2 }), { versionEsperada: 2, estado: 'cerrado', actor: ADMIN });
  g.gestor.captura().reabrirSenado({ mesaId: g.mesa, versionEsperada: 3, actor: ADMIN });
  g.gestor.captura().reiniciarSenado({ mesaId: g.mesa, versionEsperada: 4, actor: ADMIN });
  const a = auditoria(g);
  assert.deepEqual(a.map((f) => f.accion), ['autoguardar', 'guardar', 'cerrar', 'reabrir', 'reiniciar']);
  assert.equal(JSON.parse(a[0].valor_nuevo).modo, 'sabana', 'el alta registra el modo');
  const dif = [JSON.parse(a[1].valor_anterior), JSON.parse(a[1].valor_nuevo)];
  assert.deepEqual(dif[0], { mesa_id: g.mesa, blancas: 1, votos: { 1: 2 } });
  assert.deepEqual(dif[1], { mesa_id: g.mesa, blancas: 2, votos: { 1: 3 } });
  assert.deepEqual(JSON.parse(a[2].valor_nuevo), { mesa_id: g.mesa, estado: 'cerrado' }, 'cerrar sin tocar números solo audita el estado');
  assert.equal(a[2].actor_tipo, 'admin');
  assert.equal(JSON.parse(a[4].valor_anterior).modo, 'sabana', 'reiniciar guarda la foto de lo que había');
  g.gestor.cerrar();
});

test('la auditoría solo contiene contadores: nunca el contenido de una papeleta', async () => {
  const g = await montar();
  guardar(g, sab());
  const a = auditoria(g).map((f) => f.valor_nuevo).join('');
  assert.doesNotMatch(a, /papeleta\b|marcas_de|ids/i);
  const columnas = new Database(g.rutaDemo, { readonly: true }).prepare("SELECT name FROM pragma_table_info('senado_matriz')").all().map((c) => c.name);
  assert.deepEqual(columnas, ['mesa_id', 'marcas', 'mismo_partido', 'papeletas']);
  g.gestor.cerrar();
});

test('aislamiento: en DEMO el Senado va solo a demo.db; en REAL solo a app.db; la demo no sobrevive al paso a REAL', async () => {
  const g = await montar();
  guardar(g, sab());
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 0, 'nada en app.db en DEMO');
  assert.equal(g.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'senado'").get().n, 0);
  const demo = new Database(g.rutaDemo, { readonly: true });
  assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 1);
  assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM senado_voto').get().n, 2);
  assert.ok(g.gestor.contarRegistrosDemo() >= 1, 'los registros de demo del Senado cuentan al avisar de lo que se pierde');
  demo.close();
  g.gestor.cambiarModo('REAL', ADMIN);
  assert.equal(g.gestor.captura().destino, 'real');
  guardar(g, tot());
  assert.equal(g.db.prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 1);
  assert.equal(g.db.prepare("SELECT modo FROM senado_mesa").get().modo, 'totales', 'la demo anterior no se heredó');
  assert.equal(auditoria(g, 'real').length, 1);
  g.gestor.cerrar();
});

test('listarSenado reúne cabeceras, votos y matriz de todas las mesas', async () => {
  const g = await montar();
  guardar(g, sab());
  const otra = g.db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1 OFFSET 1').get().id;
  g.gestor.captura().guardarSenado({ mesaId: otra, valores: tot(), estado: 'borrador', versionEsperada: 0, actor: AGENTE });
  const todo = g.gestor.captura().listarSenado();
  assert.deepEqual([...todo.keys()].sort(), [g.mesa, otra].sort());
  assert.equal(todo.get(g.mesa).matriz.get('1:1'), 1);
  assert.equal(todo.get(otra).matriz.size, 0);
  g.gestor.cerrar();
});
