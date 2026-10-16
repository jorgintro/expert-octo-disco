import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { ErrorCandidato, borrarCandidato, crearCandidato, editarCandidato, listarCandidatos, moverCandidato } from '../src/candidatosSenado.js';
import { borrarCandidatura, ErrorCandidatura } from '../src/candidaturas.js';
import { estructuraSenadoBloqueada, fijarAbierto, fijarSenadoAbierto, recuentoAbierto, senadoAbierto, senadoActivado } from '../src/recuentoEstado.js';
import {
  abrirSenado, cargarMesaSenado, cerrarSenado, comprobarAperturaSenado, guardarSenadoMesa, reabrirSenadoMesa, reiniciarSenadoMesa,
} from '../src/servicioSenado.js';
import {
  CANDIDATURAS_MADRID, candidatosSenadoEjemplo, crearEntorno, crearReloj, insertarCandidaturas, insertarCandidatosSenado,
} from './ayuda.js';

const ADMIN = { tipo: 'admin', id: 1 };
const AGENTE = { tipo: 'agente', id: 7 };
const DEMO_ISO = '2026-10-20T10:00:00Z';
const REAL_21H = '2026-11-29T20:30:00Z';
const REAL_11H = '2026-11-29T10:00:00Z';

async function montar(iso = DEMO_ISO, { nCand = 13 } = {}) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const partidos = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(0, 2));
  const ids = insertarCandidatosSenado(e.db, candidatosSenadoEjemplo(partidos).slice(0, nCand));
  e.app.datos.sincronizar();
  const mesa = e.db.prepare("SELECT id, censo FROM mesa WHERE codigo = '4-2-A'").get();
  const modo = () => e.app.datos.estado.modo;
  const captura = () => e.app.datos.captura();
  const abrir = () => fijarSenadoAbierto(e.db, modo(), true);
  const txt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
  const totales = ({ validas = '', blancas = '', nulas = '', votos = {}, resto = '' } = {}) => ({
    modo: 'totales', validas: String(validas), blancas: String(blancas), nulas: String(nulas), matriz: {},
    votos: Object.fromEntries(ids.map((id, i) => [id, String(votos[i] ?? resto)])),
  });
  const sabana = ({ blancas = 0, nulas = 0, votos = {}, matriz = {} } = {}) => ({
    modo: 'sabana', validas: '', blancas: String(blancas), nulas: String(nulas),
    votos: Object.fromEntries(ids.map((id, i) => [id, String(votos[i] ?? 0)])),
    matriz: txt({ '1:1': 0, '2:0': 0, '2:1': 0, '3:0': 0, '3:1': 0, ...matriz }),
  });
  const guardar = (extra = {}) =>
    guardarSenadoMesa({ db: e.db, captura: captura(), actor: AGENTE, mesaId: mesa.id, entrada: totales(), version: 0, modo: modo(), ...extra });
  const cab = () => captura().obtenerSenado(mesa.id).cab;
  return { ...e, partidos, ids, mesa, modo, captura, abrir, totales, sabana, guardar, cab };
}
// 10 válidas, 2 blancas, 1 nula (13 papeletas); votos 4+3+5 = 12 ∈ [10, 30]; el resto de candidatos, 0.
const CUADRA = { validas: 10, blancas: 2, nulas: 1, votos: [4, 3, 5], resto: 0 };

test('con el Senado cerrado el agente no puede tocar nada; el administrador sí (plan B)', async () => {
  const e = await montar();
  assert.equal(e.guardar({ entrada: e.totales({ validas: 5 }) }).estado, 'senado_cerrado');
  assert.equal(e.cab(), null, 'no se escribió nada');
  assert.equal(e.guardar({ actor: ADMIN, entrada: e.totales({ validas: 5 }) }).estado, 'guardado');
  e.abrir();
  assert.equal(e.guardar({ version: 1, entrada: e.totales({ validas: 6 }) }).estado, 'bloqueado', 'lo del administrador no lo edita el agente');
});

test('interruptor propio: independiente del Congreso y separado por modo; REAL empieza cerrado', async () => {
  const e = await montar();
  assert.equal(senadoAbierto(e.db, 'DEMO'), false);
  assert.equal(senadoAbierto(e.db, 'REAL'), false);
  fijarAbierto(e.db, 'DEMO', true); // abrir el Congreso no abre el Senado
  assert.equal(senadoAbierto(e.db, 'DEMO'), false);
  assert.equal(abrirSenado(e.db, 'DEMO', ADMIN), true);
  assert.equal(abrirSenado(e.db, 'DEMO', ADMIN), false, 'abrir dos veces no hace nada');
  assert.equal(senadoAbierto(e.db, 'DEMO'), true);
  assert.equal(senadoAbierto(e.db, 'REAL'), false, 'abrir en DEMO nunca abre REAL');
  assert.equal(recuentoAbierto(e.db, 'DEMO'), true);
  assert.equal(cerrarSenado(e.db, 'DEMO', ADMIN), true);
  assert.equal(recuentoAbierto(e.db, 'DEMO'), true, 'cerrar el Senado no cierra el Congreso');
  const a = e.db.prepare("SELECT accion, actor_tipo FROM auditoria WHERE accion LIKE '%senado' ORDER BY id").all();
  assert.deepEqual(a.map((f) => f.accion), ['abrir_senado', 'cerrar_senado']);
});

test('apertura: hace falta algún candidato activo; en REAL antes de las 20:00 avisa (sin bloquear) y no pide participación', async () => {
  const vacio = await crearEntorno({ reloj: crearReloj(DEMO_ISO) });
  vacio.app.datos.sincronizar();
  assert.match(comprobarAperturaSenado({ db: vacio.db, modo: 'DEMO', ahora: Date.parse(DEMO_ISO) }).motivos[0], /No hay candidatos del Senado activos/);
  const temprano = await montar(REAL_11H);
  const r = comprobarAperturaSenado({ db: temprano.db, modo: 'REAL', ahora: Date.parse(REAL_11H) });
  assert.equal(r.ok, true, 'sin requisito de participación (solo el Congreso lo exige)');
  assert.match(r.avisos[0], /los colegios cierran a las 20:00/);
  const tarde = await montar(REAL_21H);
  assert.deepEqual(comprobarAperturaSenado({ db: tarde.db, modo: 'REAL', ahora: Date.parse(REAL_21H) }).avisos, []);
  assert.deepEqual(comprobarAperturaSenado({ db: temprano.db, modo: 'DEMO', ahora: Date.parse(REAL_11H) }).avisos, [], 'en DEMO no hay aviso horario');
});

test('modo por mesa: el primer dato lo fija; el otro modo se rechaza; solo el administrador reinicia', async () => {
  const e = await montar();
  e.abrir();
  assert.equal(e.guardar({ entrada: e.totales() }).estado, 'sin_datos', 'sin ningún dato no se fija el modo');
  assert.equal(e.cab(), null);
  assert.equal(e.guardar({ entrada: e.sabana({ blancas: 1 }) }).estado, 'guardado');
  assert.equal(e.cab().modo, 'sabana');
  const r = e.guardar({ version: 1, entrada: e.totales({ validas: 3 }) });
  assert.equal(r.estado, 'modo_distinto');
  assert.match(r.mensaje, /ya se está contando en modo «sábana a sábana».*Solo el administrador/);
  assert.equal(e.cab().version, 1);
  assert.throws(() => reiniciarSenadoMesa({ db: e.db, captura: e.captura(), actor: AGENTE, mesaId: e.mesa.id, version: 1 }), /Solo el administrador/);
  assert.equal(reiniciarSenadoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 1 }).estado, 'reiniciada');
  assert.equal(e.guardar({ entrada: e.totales({ validas: 3 }) }).estado, 'guardado', 'tras reiniciar ya se puede usar el otro modo');
  assert.equal(e.cab().modo, 'totales');
});

test('totales: borrador parcial se guarda; cerrar exige todo y que cuadren las reglas; errores no escriben', async () => {
  const e = await montar();
  e.abrir();
  assert.equal(e.guardar({ entrada: e.totales({ validas: 10, votos: [4] }) }).estado, 'guardado');
  const incompleto = e.guardar({ version: 1, cerrar: true, entrada: e.totales({ validas: 10, votos: [4] }) });
  assert.equal(incompleto.estado, 'error');
  assert.match(incompleto.errores[0], /hay que rellenar todo/);
  const rango = e.guardar({ version: 1, cerrar: true, entrada: e.totales({ ...CUADRA, votos: [1, 1, 1] }) });
  assert.match(rango.errores[0], /entre las papeletas válidas \(10\) y 3 veces/);
  const exceso = e.guardar({ version: 1, entrada: e.totales({ validas: 10, votos: [11] }) });
  assert.match(exceso.errores[0], /más votos \(11\) que papeletas válidas \(10\)/);
  const censo = e.guardar({ version: 1, entrada: e.totales({ validas: e.mesa.censo, blancas: 1 }) });
  assert.match(censo.errores[0], /no pueden superar el censo/);
  const formato = e.guardar({ version: 1, entrada: e.totales({ validas: '1x' }) });
  assert.match(formato.errores[0], /Papeletas válidas: solo cifras/);
  assert.equal(e.cab().version, 1, 'los errores no escriben');
});

test('sábana: la coherencia marcas/votos se comprueba en servidor aunque la pantalla la garantice', async () => {
  const e = await montar();
  e.abrir();
  const ok = e.guardar({ entrada: e.sabana({ votos: [2, 1], matriz: { '1:1': 1, '2:1': 1 }, blancas: 1 }) });
  assert.equal(ok.estado, 'guardado');
  assert.deepEqual([e.cab().validas, e.cab().blancas], [2, 1], 'las válidas se derivan de la matriz');
  const trucada = e.guardar({ version: 1, entrada: e.sabana({ votos: [5, 1], matriz: { '1:1': 1, '2:1': 1 } }) });
  assert.equal(trucada.estado, 'error');
  assert.match(trucada.errores[0], /marcas por papeleta \(3\) no coinciden con la suma de votos de los candidatos \(6\)/);
  const exceso = e.guardar({ version: 1, entrada: e.sabana({ votos: [2, 0, 0], matriz: { '1:1': 1, '2:1': 0 } }) });
  assert.equal(exceso.estado, 'error', 'un candidato con más votos que válidas');
  assert.equal(e.cab().version, 1);
});

test('cerrar: siempre pide confirmación; los avisos (Congreso y participación) van dentro y no bloquean', async () => {
  const e = await montar();
  e.abrir();
  const sinAvisos = e.guardar({ cerrar: true, entrada: e.totales(CUADRA) });
  assert.equal(sinAvisos.estado, 'confirmar');
  assert.deepEqual(sinAvisos.avisos, []);
  assert.equal(e.cab(), null, 'sin confirmar no se cierra ni se guarda');
  // El Congreso de esta mesa tiene 20 votantes; la participación informada, 18.
  e.captura().guardarRecuento({ mesaId: e.mesa.id, valores: { votantes: 20, blancos: undefined, nulos: undefined, votos: new Map() }, estado: 'borrador', versionEsperada: 0, actor: ADMIN });
  const corte = e.db.prepare('SELECT id FROM corte ORDER BY orden DESC').get().id;
  e.captura().guardarParticipacion({ mesaId: e.mesa.id, corteId: corte, votantes: 18, actor: ADMIN });
  const conAvisos = e.guardar({ cerrar: true, entrada: e.totales(CUADRA) });
  assert.equal(conAvisos.estado, 'confirmar');
  assert.equal(conAvisos.avisos.length, 2);
  const cerrado = e.guardar({ cerrar: true, confirmar: true, entrada: e.totales(CUADRA) });
  assert.deepEqual([cerrado.estado, cerrado.version], ['cerrado', 1]);
  assert.equal(e.cab().estado, 'cerrado');
});

test('mesa cerrada: el agente no la edita; el administrador la edita (validada como cierre), la reabre y la autoría se conserva', async () => {
  const e = await montar();
  e.abrir();
  e.guardar({ cerrar: true, confirmar: true, entrada: e.totales(CUADRA) });
  assert.equal(e.guardar({ version: 1, entrada: e.totales({ ...CUADRA, blancas: 3 }) }).estado, 'mesa_cerrada');
  const roto = e.guardar({ actor: ADMIN, version: 1, entrada: e.totales({ ...CUADRA, validas: 40 }) });
  assert.equal(roto.estado, 'error', 'editar una mesa cerrada se valida como un cierre');
  const ok = e.guardar({ actor: ADMIN, version: 1, entrada: e.totales({ ...CUADRA, blancas: 3 }) });
  assert.equal(ok.estado, 'guardado');
  assert.equal(e.cab().estado, 'cerrado');
  assert.equal(e.cab().introducido_por_tipo, 'admin');
  const re = reabrirSenadoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 2 });
  assert.deepEqual([re.estado, re.version], ['reabierta', 3]);
  assert.throws(() => reabrirSenadoMesa({ db: e.db, captura: e.captura(), actor: AGENTE, mesaId: e.mesa.id, version: 3 }), /Solo el administrador/);
  assert.equal(e.cab().introducido_por_tipo, 'admin', 'reabrir conserva la autoría: el agente sigue sin poder editar');
  assert.equal(e.guardar({ version: 3, entrada: e.totales(CUADRA) }).estado, 'bloqueado');
});

test('conflicto de versión: devuelve la versión actual y los contadores del servidor; no escribe', async () => {
  const e = await montar();
  e.abrir();
  e.guardar({ entrada: e.sabana({ votos: [1], matriz: { '1:1': 1 } }) });
  const r = e.guardar({ version: 0, entrada: e.sabana({ votos: [9], matriz: { '1:1': 9 } }) });
  assert.equal(r.estado, 'conflicto');
  assert.equal(r.versionActual, 1);
  assert.deepEqual([r.contadores.version, r.contadores.votos[e.ids[0]], r.contadores.matriz['1:1']], [1, 1, 1]);
  assert.equal(e.captura().obtenerSenado(e.mesa.id).votos.get(e.ids[0]), 1);
});

test('estructura: con el Senado activado no se puede crear, mover ni desactivar; nombre, partido y color siguen editables', async () => {
  const e = await montar();
  const cand = listarCandidatos(e.db)[0];
  const v = (extra = {}) => ({ nombre: cand.nombre, candidatura_id: cand.candidatura_id, agrupacion: '', color: cand.color, activo: 1, ...extra });
  crearCandidato(e.db, { valores: v({ nombre: 'Nuevo Antes' }) }, ADMIN, 'DEMO'); // libre
  abrirSenado(e.db, 'DEMO', ADMIN);
  assert.equal(senadoActivado(e.db, 'DEMO'), true);
  assert.equal(estructuraSenadoBloqueada(e.db, 'DEMO'), true);
  assert.throws(() => crearCandidato(e.db, { valores: v({ nombre: 'Nuevo' }) }, ADMIN, 'DEMO'), (x) => x instanceof ErrorCandidato && x.codigo === 409);
  assert.throws(() => moverCandidato(e.db, cand.id, 'bajar', ADMIN, 'DEMO'), ErrorCandidato);
  assert.throws(() => editarCandidato(e.db, cand.id, { valores: v({ activo: 0 }) }, ADMIN, 'DEMO'), ErrorCandidato);
  assert.throws(() => borrarCandidato(e.db, cand.id, ADMIN, 'DEMO', { real: new Map(), demo: new Map() }), ErrorCandidato);
  editarCandidato(e.db, cand.id, { valores: v({ nombre: 'Ana Pérez López', color: '#112233' }) }, ADMIN, 'DEMO');
  assert.equal(listarCandidatos(e.db)[0].nombre, 'Ana Pérez López');
  const a = e.db.prepare("SELECT accion, valor_anterior, valor_nuevo FROM auditoria WHERE entidad = 'candidato_senado' AND accion = 'editar'").all();
  assert.deepEqual(JSON.parse(a.at(-1).valor_nuevo), { nombre: 'Ana Pérez López', color: '#112233' }, 'solo diferencias');
});

test('«Reiniciar demo» desbloquea la estructura de la demo; el REAL activado la bloquea siempre', async () => {
  const e = await montar();
  abrirSenado(e.db, 'DEMO', ADMIN);
  assert.equal(estructuraSenadoBloqueada(e.db, 'DEMO'), true);
  e.app.datos.reiniciarDemo(ADMIN);
  assert.equal(estructuraSenadoBloqueada(e.db, 'DEMO'), false);
  assert.equal(senadoAbierto(e.db, 'DEMO'), false);
  fijarSenadoAbierto(e.db, 'REAL', true);
  assert.equal(estructuraSenadoBloqueada(e.db, 'DEMO'), true, 'aunque estemos en DEMO, el REAL activado bloquea');
  fijarSenadoAbierto(e.db, 'REAL', false);
  assert.equal(estructuraSenadoBloqueada(e.db, 'REAL'), true, 'cerrar no desbloquea');
});

test('no se borra un candidato con votos (reales ni de demo); se desactiva; una candidatura con senadores asociados no se borra', async () => {
  const e = await montar();
  e.abrir();
  e.guardar({ entrada: e.totales({ validas: 5, votos: [3] }) });
  const [id, sinVotos] = [e.ids[0], e.ids.at(-1)];
  const votos = e.app.datos.contarVotosPorCandidato();
  assert.equal(votos.demo.get(id), 1);
  // La estructura está libre solo si el Senado no se ha activado: se prueba con modo REAL sin activar.
  fijarSenadoAbierto(e.db, 'DEMO', false);
  e.db.prepare("DELETE FROM ajuste WHERE clave LIKE 'senado_%'").run();
  assert.throws(() => borrarCandidato(e.db, id, ADMIN, 'DEMO', votos), /tiene votos \(0 reales, 1 de demo\).*desactívalo/);
  assert.doesNotThrow(() => borrarCandidato(e.db, sinVotos, ADMIN, 'DEMO', votos));
  assert.equal(listarCandidatos(e.db).some((c) => c.id === sinVotos), false);
  assert.deepEqual(listarCandidatos(e.db).map((c) => c.orden), listarCandidatos(e.db).map((_, i) => i + 1), 'el orden se renumera');
  editarCandidato(e.db, id, { valores: { nombre: 'Ana Pérez', candidatura_id: e.partidos[0], agrupacion: '', color: '#546e7a', activo: 0 } }, ADMIN, 'DEMO');
  assert.equal(listarCandidatos(e.db).find((c) => c.id === id).activo, 0, 'desactivar sí se puede');
  assert.throws(() => borrarCandidatura(e.db, e.partidos[0], ADMIN, 'DEMO', { real: new Map(), demo: new Map() }), (x) => x instanceof ErrorCandidatura && /candidatos del Senado/.test(x.message));
});

test('un candidato inactivo con votos en la mesa sigue apareciendo en ella (no se esconden datos)', async () => {
  const e = await montar();
  e.abrir();
  e.guardar({ entrada: e.totales({ validas: 5, votos: [3] }) });
  e.db.prepare('UPDATE candidato_senado SET activo = 0 WHERE id = ?').run(e.ids[0]);
  e.db.prepare('UPDATE candidato_senado SET activo = 0 WHERE id = ?').run(e.ids[1]);
  const datos = cargarMesaSenado(e.db, e.captura(), e.mesa.id);
  assert.ok(datos.candidatos.some((c) => c.id === e.ids[0]));
  assert.ok(!datos.candidatos.some((c) => c.id === e.ids[1]));
});

test('el Senado no escribe nunca en la otra base: en DEMO, app.db sin senado; en REAL, sin demo.db', async () => {
  const e = await montar();
  e.abrir();
  e.guardar({ entrada: e.totales({ validas: 5, votos: [3] }) });
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 0);
  const demo = new Database(path.join(e.dataDir, 'demo.db'), { readonly: true });
  assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM senado_mesa').get().n, 1);
  demo.close();
});
